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
  console.log('=== Testing Fixed Weekly Lead Inventory ===\n');

  // Get current values
  const { data: precalc } = await supabase
    .from('dashboard_precalc')
    .select('totals, weekly_lead_inventory')
    .eq('id', 1)
    .single();

  const currentWeeklyTotal = precalc.weekly_lead_inventory.reduce((sum, w) => sum + w.leads_added, 0);

  console.log('Current (before fix):');
  console.log('  Weekly total:', currentWeeklyTotal.toLocaleString());
  console.log('  totals.all_accepted:', precalc.totals.all_accepted.toLocaleString());

  // Fetch data for last 8 weeks
  const eightWeeksAgo = new Date();
  eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);

  console.log('\n--- Fetching CONSENSUS_RESULT data (last 8 weeks) ---\n');

  let allData = [];
  let offset = 0;
  const batchSize = 1000;

  while (true) {
    const { data } = await supabase
      .from('transparency_log')
      .select('ts, payload')
      .eq('event_type', 'CONSENSUS_RESULT')
      .not('payload->lead_id', 'is', null)
      .gte('ts', eightWeeksAgo.toISOString())
      .range(offset, offset + batchSize - 1);

    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < batchSize) break;
    offset += batchSize;

    if (offset % 50000 === 0) {
      console.log('  Fetched ' + offset.toLocaleString() + ' rows...');
    }
  }

  console.log('  Total fetched: ' + allData.length.toLocaleString());

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

  // Count accepted by latest decision, grouped by week
  const acceptedDecisions = ['ALLOW', 'ALLOWED', 'ACCEPT', 'ACCEPTED', 'APPROVE', 'APPROVED'];

  // Helper to get week start (Sunday)
  const getWeekStart = (dateStr) => {
    const d = new Date(dateStr);
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    return d.toISOString().split('T')[0];
  };

  const weeklyCounts = new Map();
  let totalAccepted = 0;

  for (const [leadId, info] of latestByLead) {
    if (acceptedDecisions.includes(info.decision)) {
      totalAccepted++;
      const weekStart = getWeekStart(info.date);
      weeklyCounts.set(weekStart, (weeklyCounts.get(weekStart) || 0) + 1);
    }
  }

  // Sort and display
  const sortedWeeks = Array.from(weeklyCounts.entries()).sort((a, b) => b[0].localeCompare(a[0]));

  console.log('\n=== FIXED Weekly Lead Inventory ===\n');
  console.log('Week Start      | Leads Added');
  console.log('----------------|------------');

  let fixedTotal = 0;
  for (const [week, count] of sortedWeeks.slice(0, 8)) {
    fixedTotal += count;
    console.log(week + '      | ' + count.toLocaleString().padStart(10));
  }
  console.log('----------------|------------');
  console.log('Fixed Total:    | ' + fixedTotal.toLocaleString().padStart(10));

  console.log('\n=== COMPARISON ===\n');
  console.log('Current weekly total:', currentWeeklyTotal.toLocaleString());
  console.log('Fixed weekly total:', fixedTotal.toLocaleString());
  console.log('Difference:', (currentWeeklyTotal - fixedTotal).toLocaleString());
  console.log('');
  console.log('totals.all_accepted:', precalc.totals.all_accepted.toLocaleString());
  console.log('Fixed weekly matches totals:', fixedTotal === precalc.totals.all_accepted ? 'YES ✓' : 'NO (expected, weekly is last 8 weeks only)');
}

test().catch(console.error);
