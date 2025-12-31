import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// Read .env.local manually
const envContent = readFileSync('.env.local', 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) env[match[1]] = match[2];
}

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function verify() {
  console.log('=== Verifying Lead Count Discrepancy ===\n');

  // 1. Get totals from precalc
  const { data: precalc } = await supabase
    .from('dashboard_precalc')
    .select('totals, lead_inventory')
    .eq('id', 1)
    .single();

  const totalsAccepted = precalc.totals.all_accepted;
  const latestInventory = precalc.lead_inventory.sort((a,b) =>
    new Date(b.date) - new Date(a.date)
  )[0];
  const cumulativeLeads = latestInventory.cumulative;

  console.log('From dashboard_precalc:');
  console.log('  totals.all_accepted:', totalsAccepted.toLocaleString());
  console.log('  lead_inventory latest cumulative:', cumulativeLeads.toLocaleString());
  console.log('  Difference:', (cumulativeLeads - totalsAccepted).toLocaleString());

  // 2. Sum of daily new_leads from lead_inventory
  const sumDaily = precalc.lead_inventory.reduce((acc, d) => acc + d.new_leads, 0);
  console.log('\nSum of all daily new_leads:', sumDaily.toLocaleString());
  console.log('Matches cumulative:', sumDaily === cumulativeLeads ? 'YES' : 'NO');

  console.log('\n--- Fetching CONSENSUS_RESULT data to check duplicates ---\n');

  // 3. Fetch ALL accepted CONSENSUS_RESULT events (paginated)
  let allData = [];
  let offset = 0;
  const batchSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('transparency_log')
      .select('ts, payload')
      .eq('event_type', 'CONSENSUS_RESULT')
      .not('payload->lead_id', 'is', null)
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.log('Error:', error);
      break;
    }
    if (!data || data.length === 0) break;

    allData.push(...data);
    if (data.length < batchSize) break;
    offset += batchSize;

    if (offset % 10000 === 0) {
      console.log('  Fetched ' + offset.toLocaleString() + ' rows...');
    }
  }

  console.log('Total CONSENSUS_RESULT events fetched: ' + allData.length.toLocaleString());

  // Filter accepted and group by lead_id -> dates
  const leadDates = new Map();
  let acceptedCount = 0;

  for (const row of allData) {
    const decision = (row.payload?.final_decision || '').toUpperCase();
    if (['ALLOW', 'ALLOWED', 'ACCEPT', 'ACCEPTED', 'APPROVE', 'APPROVED'].includes(decision)) {
      acceptedCount++;
      const leadId = row.payload?.lead_id;
      if (leadId) {
        const date = row.ts.split('T')[0];
        if (!leadDates.has(leadId)) {
          leadDates.set(leadId, new Set());
        }
        leadDates.get(leadId).add(date);
      }
    }
  }

  console.log('Accepted CONSENSUS_RESULT events: ' + acceptedCount.toLocaleString());
  console.log('Unique accepted lead_ids: ' + leadDates.size.toLocaleString());

  // Count leads appearing on multiple days
  let multiDayLeads = 0;
  let extraCounts = 0;
  const examples = [];

  for (const [leadId, dates] of leadDates) {
    if (dates.size > 1) {
      multiDayLeads++;
      extraCounts += dates.size - 1;
      if (examples.length < 3) {
        examples.push({ leadId: leadId.substring(0, 20) + '...', dates: Array.from(dates).sort() });
      }
    }
  }

  console.log('\nLead_ids appearing on MULTIPLE days: ' + multiDayLeads.toLocaleString());
  console.log('Extra counts from duplicates: ' + extraCounts.toLocaleString());

  if (examples.length > 0) {
    console.log('\nExamples of duplicated lead_ids:');
    for (const ex of examples) {
      console.log('  ' + ex.leadId + ' appeared on: ' + ex.dates.join(', '));
    }
  }

  // Check for leads that were ACCEPTED at some point but LATEST decision is REJECTED
  console.log('\n--- Checking for leads accepted earlier, rejected later ---\n');

  const leadHistory = new Map(); // lead_id -> { accepted: bool, latestDecision: string, latestTs: string }

  for (const row of allData) {
    const decision = (row.payload?.final_decision || '').toUpperCase();
    const leadId = row.payload?.lead_id;
    if (!leadId) continue;

    const isAccepted = ['ALLOW', 'ALLOWED', 'ACCEPT', 'ACCEPTED', 'APPROVE', 'APPROVED'].includes(decision);
    const isRejected = ['DENY', 'DENIED', 'REJECT', 'REJECTED'].includes(decision);

    if (!leadHistory.has(leadId)) {
      leadHistory.set(leadId, { wasAccepted: false, latestDecision: decision, latestTs: row.ts });
    }

    const entry = leadHistory.get(leadId);
    if (isAccepted) {
      entry.wasAccepted = true;
    }
    if (row.ts > entry.latestTs) {
      entry.latestTs = row.ts;
      entry.latestDecision = decision;
    }
  }

  // Count leads that were accepted at some point but latest is rejected
  let acceptedThenRejected = 0;
  for (const [leadId, entry] of leadHistory) {
    const latestIsRejected = ['DENY', 'DENIED', 'REJECT', 'REJECTED'].includes(entry.latestDecision.toUpperCase());
    if (entry.wasAccepted && latestIsRejected) {
      acceptedThenRejected++;
    }
  }

  console.log('Leads that were ACCEPTED then later REJECTED: ' + acceptedThenRejected.toLocaleString());

  console.log('\n=== CONCLUSION ===');
  console.log('Multi-day duplicates: ' + extraCounts.toLocaleString());
  console.log('Accepted then rejected: ' + acceptedThenRejected.toLocaleString());
  console.log('Total explained: ' + (extraCounts + acceptedThenRejected).toLocaleString());
  console.log('Actual difference: ' + (cumulativeLeads - totalsAccepted).toLocaleString());

  const explained = extraCounts + acceptedThenRejected;
  const actual = cumulativeLeads - totalsAccepted;
  if (Math.abs(explained - actual) < 50) {
    console.log('✓ CONFIRMED: Discrepancy explained by duplicates + decision changes');
  } else {
    console.log('⚠ Still ' + (actual - explained).toLocaleString() + ' unexplained');
  }

  // Export to CSV
  console.log('\n--- Exporting to CSV ---\n');

  const csvRows = [];
  csvRows.push(['lead_id', 'issue_type', 'dates_appeared', 'was_accepted', 'latest_decision', 'latest_ts']);

  // Multi-day duplicates
  for (const [leadId, dates] of leadDates) {
    if (dates.size > 1) {
      const entry = leadHistory.get(leadId);
      csvRows.push([
        leadId,
        'multi_day_duplicate',
        Array.from(dates).sort().join('; '),
        'true',
        entry?.latestDecision || '',
        entry?.latestTs || ''
      ]);
    }
  }

  // Accepted then rejected
  for (const [leadId, entry] of leadHistory) {
    const latestIsRejected = ['DENY', 'DENIED', 'REJECT', 'REJECTED'].includes(entry.latestDecision.toUpperCase());
    if (entry.wasAccepted && latestIsRejected) {
      // Check if already added as multi-day duplicate
      const dates = leadDates.get(leadId);
      if (!dates || dates.size <= 1) {
        csvRows.push([
          leadId,
          'accepted_then_rejected',
          dates ? Array.from(dates).sort().join('; ') : '',
          'true',
          entry.latestDecision,
          entry.latestTs
        ]);
      } else {
        // Update existing row to show both issues
        const existingRow = csvRows.find(r => r[0] === leadId);
        if (existingRow) {
          existingRow[1] = 'multi_day_duplicate + accepted_then_rejected';
        }
      }
    }
  }

  // Write CSV
  const { writeFileSync } = await import('fs');
  const csvContent = csvRows.map(row => row.map(cell => '"' + String(cell).replace(/"/g, '""') + '"').join(',')).join('\n');
  const outputPath = '/home/tasnimul/Desktop/Work/lead_inventory_discrepancy.csv';
  writeFileSync(outputPath, csvContent);
  console.log('Exported ' + (csvRows.length - 1) + ' rows to: ' + outputPath);
}

verify().catch(console.error);
