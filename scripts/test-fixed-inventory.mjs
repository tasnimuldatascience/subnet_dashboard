import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const envContent = readFileSync('.env.local', 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) env[match[1]] = match[2];
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function test() {
  console.log('=== Testing Fixed Lead Inventory Logic ===\n');

  // Get current values from precalc
  const { data: precalc } = await supabase
    .from('dashboard_precalc')
    .select('totals, lead_inventory')
    .eq('id', 1)
    .single();

  const currentTotalsAccepted = precalc.totals.all_accepted;
  const currentCumulative = precalc.lead_inventory.sort((a,b) =>
    new Date(b.date) - new Date(a.date)
  )[0].cumulative;

  console.log('Current values (from precalc):');
  console.log('  totals.all_accepted:', currentTotalsAccepted.toLocaleString());
  console.log('  lead_inventory cumulative:', currentCumulative.toLocaleString());
  console.log('  Difference:', (currentCumulative - currentTotalsAccepted).toLocaleString());

  console.log('\n--- Running fixed query (latest decision only) ---\n');

  // Fetch all CONSENSUS_RESULT with lead_id
  let allData = [];
  let offset = 0;
  const batchSize = 1000;

  while (true) {
    const { data } = await supabase
      .from('transparency_log')
      .select('ts, payload')
      .eq('event_type', 'CONSENSUS_RESULT')
      .not('payload->lead_id', 'is', null)
      .range(offset, offset + batchSize - 1);

    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < batchSize) break;
    offset += batchSize;

    if (offset % 50000 === 0) {
      console.log('  Fetched ' + offset.toLocaleString() + ' rows...');
    }
  }

  console.log('  Total CONSENSUS_RESULT fetched: ' + allData.length.toLocaleString());

  // Find latest decision for each lead_id
  const latestByLead = new Map();
  for (const row of allData) {
    const leadId = row.payload?.lead_id;
    if (!leadId) continue;

    const existing = latestByLead.get(leadId);
    if (!existing || new Date(row.ts) > new Date(existing.ts)) {
      latestByLead.set(leadId, {
        ts: row.ts,
        date: row.ts.split('T')[0],
        decision: (row.payload?.final_decision || '').toUpperCase()
      });
    }
  }

  console.log('  Unique lead_ids: ' + latestByLead.size.toLocaleString());

  // Count accepted by latest decision, grouped by date
  const acceptedDecisions = ['ALLOW', 'ALLOWED', 'ACCEPT', 'ACCEPTED', 'APPROVE', 'APPROVED'];
  const dailyCounts = new Map();
  let totalAccepted = 0;

  for (const [leadId, info] of latestByLead) {
    if (acceptedDecisions.includes(info.decision)) {
      totalAccepted++;
      dailyCounts.set(info.date, (dailyCounts.get(info.date) || 0) + 1);
    }
  }

  // Calculate cumulative
  const sortedDates = Array.from(dailyCounts.keys()).sort();
  let cumulative = 0;
  const dailyInventory = [];
  for (const date of sortedDates) {
    cumulative += dailyCounts.get(date);
    dailyInventory.push({ date, new_leads: dailyCounts.get(date), cumulative });
  }

  const latestCumulative = dailyInventory.length > 0
    ? dailyInventory[dailyInventory.length - 1].cumulative
    : 0;

  console.log('\n=== RESULTS ===\n');
  console.log('Fixed logic (latest decision only):');
  console.log('  Total accepted (should match totals.all_accepted):', totalAccepted.toLocaleString());
  console.log('  New cumulative:', latestCumulative.toLocaleString());
  console.log('');
  console.log('Comparison:');
  console.log('  totals.all_accepted:', currentTotalsAccepted.toLocaleString());
  console.log('  Fixed cumulative:', latestCumulative.toLocaleString());
  console.log('  Difference:', (latestCumulative - currentTotalsAccepted).toLocaleString());

  if (latestCumulative === currentTotalsAccepted) {
    console.log('\n✓ SUCCESS: Fixed cumulative matches totals.all_accepted!');
  } else if (Math.abs(latestCumulative - currentTotalsAccepted) < 10) {
    console.log('\n✓ CLOSE: Difference is minimal (< 10), likely timing issue');
  } else {
    console.log('\n⚠ Still a difference - needs investigation');
  }

  // Show last 5 days
  console.log('\nLast 5 days (fixed):');
  const last5 = dailyInventory.slice(-5);
  for (const d of last5) {
    console.log('  ' + d.date + ': +' + d.new_leads + ' (cumulative: ' + d.cumulative.toLocaleString() + ')');
  }
}

test().catch(console.error);
