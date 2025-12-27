// Script to count processed rejection reasons
const fs = require('fs')
const path = require('path')

// Load .env.local manually
const envPath = path.join(__dirname, '..', '.env.local')
const envContent = fs.readFileSync(envPath, 'utf8')
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^=]+)=(.*)$/)
  if (match) process.env[match[1]] = match[2]
}

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

function cleanRejectionReason(reason) {
  if (!reason || reason === 'N/A' || reason.trim() === '') return 'N/A'

  try {
    if (reason.startsWith('{')) {
      const parsed = JSON.parse(reason)
      const failedFields = parsed.failed_fields || []
      if (failedFields.length > 0) {
        const fieldMap = {
          email: 'Invalid Email', website: 'Invalid Website', site: 'Invalid Website',
          source_url: 'Invalid Source URL', linkedin: 'Invalid LinkedIn', region: 'Invalid Region',
          role: 'Invalid Role', industry: 'Invalid Industry', phone: 'Invalid Phone',
          name: 'Invalid Name', first_name: 'Invalid Name', last_name: 'Invalid Name',
          company: 'Invalid Company', title: 'Invalid Title', address: 'Invalid Address',
          exception: 'Validation Error', llm_error: 'LLM Error', source_type: 'Invalid Source Type',
        }
        for (const field of failedFields) {
          const mapped = fieldMap[field.toLowerCase()]
          if (mapped) return mapped
        }
        return `Invalid ${failedFields[0].replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`
      }

      const checkName = parsed.check_name || ''
      const message = parsed.message || ''
      const checkNameMap = {
        check_truelist_email: 'Invalid Email', check_myemailverifier_email: 'Invalid Email',
        check_email_regex: 'Invalid Email', check_mx_record: 'Invalid Email',
        check_linkedin_gse: 'Invalid LinkedIn', check_head_request: 'Invalid Website',
        check_source_provenance: 'Invalid Source URL', check_domain_age: 'Invalid Website',
        check_dnsbl: 'Invalid Website', check_name_email_match: 'Name/Email Mismatch',
        check_free_email_domain: 'Free Email Domain', validation_error: 'Validation Error',
        deep_verification: 'Deep Verification Failed',
      }
      if (checkName === 'check_stage5_unified') {
        const msgLower = message.toLowerCase()
        if (msgLower.includes('region') && msgLower.includes('failed')) return 'Invalid Region'
        if (msgLower.includes('role') && msgLower.includes('failed')) return 'Invalid Role'
        if (msgLower.includes('industry') && msgLower.includes('failed')) return 'Invalid Industry'
        return 'Role/Region/Industry Failed'
      }
      if (checkNameMap[checkName]) return checkNameMap[checkName]

      const stage = parsed.stage || ''
      if (stage.includes('Email') || stage.includes('TrueList')) return 'Invalid Email'
      if (stage.includes('LinkedIn') || stage.includes('GSE')) return 'Invalid LinkedIn'
      if (stage.includes('DNS') || stage.includes('Domain')) return 'Invalid Website'
      if (stage.includes('Source Provenance')) return 'Invalid Source URL'

      if (parsed.failed_field) {
        const fm = {
          site: 'Invalid Website', website: 'Invalid Website', email: 'Invalid Email',
          phone: 'Invalid Phone', name: 'Invalid Name', company: 'Invalid Company',
          title: 'Invalid Title', linkedin: 'Invalid LinkedIn', address: 'Invalid Address',
        }
        return fm[parsed.failed_field.toLowerCase()] || `Invalid ${parsed.failed_field}`
      }
      if (parsed.reason) return parsed.reason.substring(0, 50)
      if (parsed.error) return parsed.error.substring(0, 50)
    }
  } catch { /* Not JSON */ }

  const reasonLower = reason.toLowerCase()
  if (reasonLower.includes('duplicate')) return 'Duplicate Lead'
  if (reasonLower.includes('spam')) return 'Spam Detected'
  if (reasonLower.includes('disposable')) return 'Disposable Email'
  if (reasonLower.includes('catchall') || reasonLower.includes('catch-all')) return 'Catch-all Email'
  if (reasonLower.includes('bounced') || reasonLower.includes('bounce')) return 'Email Bounced'
  if (reasonLower.includes('emailverification') && reasonLower.includes('unavailable')) return 'Email Verification Failed'

  const clean = reason.replace(/[{}\[\]"':]/g, '').replace(/\s+/g, ' ').trim()
  return clean.length > 40 ? clean.substring(0, 40) + '...' : clean
}

async function main() {
  console.log('Fetching rejection reasons from database...')

  const counts = {}
  const rawExamples = {}
  let offset = 0
  const limit = 1000  // Supabase default max
  let total = 0

  while (true) {
    const { data, error } = await supabase
      .from('transparency_log')
      .select('payload')
      .eq('event_type', 'CONSENSUS_RESULT')
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Error:', error)
      break
    }

    if (!data || data.length === 0) break

    for (const row of data) {
      const reason = row.payload?.primary_rejection_reason
      const cleaned = cleanRejectionReason(reason)
      counts[cleaned] = (counts[cleaned] || 0) + 1
      // Capture raw value for truncated messages
      if (cleaned.includes('...') && !rawExamples[cleaned]) {
        rawExamples[cleaned] = reason
      }
      total++
    }

    console.log(`Processed ${total} records...`)
    offset += data.length

    if (data.length < limit) break

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 100))
  }

  // Sort by count descending
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])

  console.log('\n=== Processed Rejection Reason Counts ===\n')
  for (const [reason, count] of sorted) {
    console.log(`${count.toString().padStart(8)} | ${reason}`)
  }
  console.log(`\nTotal: ${total}`)

  if (Object.keys(rawExamples).length > 0) {
    console.log('\n=== Raw Examples for Truncated Messages ===\n')
    for (const [cleaned, raw] of Object.entries(rawExamples)) {
      console.log(`${cleaned}`)
      console.log(`  RAW: ${raw}\n`)
    }
  }
}

main().catch(console.error)
