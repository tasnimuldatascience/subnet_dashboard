import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const envContent = readFileSync('.env.local', 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) env[match[1]] = match[2];
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

// Fetch all CONSENSUS_RESULT data (paginated) and find example
console.log('=== Example: Accepted then Rejected ===\n');
console.log('Searching for a lead that was accepted then rejected...\n');

let allData = [];
let offset = 0;
const batchSize = 1000;

while (offset < 50000) {
  const { data } = await supabase
    .from('transparency_log')
    .select('ts, payload')
    .eq('event_type', 'CONSENSUS_RESULT')
    .not('payload->lead_id', 'is', null)
    .range(offset, offset + batchSize - 1);

  if (!data || data.length === 0) break;
  allData.push(...data);
  offset += batchSize;
}

// Group by lead_id and find one with both ACCEPT and DENY
const leadEvents = new Map();
for (const row of allData) {
  const leadId = row.payload?.lead_id;
  if (!leadId) continue;
  if (!leadEvents.has(leadId)) leadEvents.set(leadId, []);
  leadEvents.get(leadId).push(row);
}

// Find a lead with both ACCEPT and later DENY
for (const [leadId, events] of leadEvents) {
  const sorted = events.sort((a, b) => new Date(a.ts) - new Date(b.ts));

  let hasAccept = false;
  let hasDenyAfterAccept = false;

  for (const e of sorted) {
    const dec = (e.payload?.final_decision || '').toUpperCase();
    if (['ALLOW', 'APPROVE', 'ACCEPT'].includes(dec)) hasAccept = true;
    if (hasAccept && ['DENY', 'REJECT'].includes(dec)) hasDenyAfterAccept = true;
  }

  if (hasAccept && hasDenyAfterAccept) {
    console.log('Lead ID:', leadId);
    console.log('\nTimeline:\n');
    for (const row of sorted) {
      const decision = row.payload?.final_decision || 'N/A';
      const epochId = row.payload?.epoch_id || 'N/A';
      const reason = row.payload?.primary_rejection_reason || '';
      console.log('  ' + row.ts);
      console.log('    Decision: ' + decision);
      console.log('    Epoch: ' + epochId);
      if (reason) console.log('    Reason: ' + reason.substring(0, 100));
      console.log('');
    }
    break;
  }
}
