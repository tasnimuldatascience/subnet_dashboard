'use client'

import { useState } from 'react'
import {
  Download,
  Copy,
  Check,
  Mail,
  Linkedin,
  Globe,
  MapPin,
  Building2,
  User,
  ChevronDown,
  ChevronRight,
  Crown,
  Tag,
  Clock,
  RotateCw,
  Target,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  formatDateTime,
  formatRelative,
  statusLabel,
  statusTone,
  asList,
  icpSignals,
  shortHotkey,
  creditedSignals,
} from '@/lib/admin-format'
import type {
  AdminFulfillmentRequest,
  AdminWinningLead,
  IcpDetails,
  IntentSignalMappingEntry,
  IntentBreakdown,
} from '@/lib/admin-supabase'

export interface RequestDetailPayload {
  chain: {
    root: AdminFulfillmentRequest
    leaf: AdminFulfillmentRequest
    cycles: AdminFulfillmentRequest[]
  }
  icp: IcpDetails | null
  winners: AdminWinningLead[]
  target_num_leads: number
  delivered_count: number
  all_submissions_count: number
}

type TabKey = 'winners' | 'icp' | 'chain'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'winners', label: 'Winning leads' },
  { key: 'icp', label: 'Client ICP' },
  { key: 'chain', label: 'Chain history' },
]

export function AdminRequestDetail({
  requestId,
  payload,
}: {
  requestId: string
  payload: RequestDetailPayload
}) {
  const [tab, setTab] = useState<TabKey>('winners')

  const { chain, icp, winners, target_num_leads, delivered_count } = payload
  const root = chain.root
  const leaf = chain.leaf

  const tone = statusTone(leaf.status)
  const isFulfilled = tone === 'fulfilled'
  const isPartial = tone === 'partial'

  return (
    <div className="space-y-6">
      {/* Hero card */}
      <section
        className="rounded-2xl border p-6 sm:p-7"
        style={{
          borderColor: 'var(--surface-border)',
          background: 'var(--surface)',
        }}
      >
        <div className="flex flex-col gap-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <StatusPill status={leaf.status} />
                {chain.cycles.length > 1 && (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] rounded-full px-2.5 py-1 border"
                    style={{
                      borderColor: 'var(--surface-border-strong)',
                      color: 'var(--text-secondary)',
                      background: 'var(--surface-elevated)',
                    }}
                  >
                    <RotateCw className="h-2.5 w-2.5" />
                    {chain.cycles.length} cycles
                  </span>
                )}
              </div>
              <h1
                className="text-2xl font-medium tracking-tight"
                style={{ color: 'var(--text-primary)' }}
              >
                {leaf.internal_label || (
                  <span style={{ color: 'var(--text-tertiary)' }}>
                    (no label)
                  </span>
                )}
              </h1>
              <div
                className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs"
                style={{ color: 'var(--text-secondary)' }}
              >
                {leaf.company && (
                  <span className="inline-flex items-center gap-1.5">
                    <Building2
                      className="h-3 w-3"
                      style={{ color: 'var(--text-tertiary)' }}
                    />
                    {leaf.company}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <Clock
                    className="h-3 w-3"
                    style={{ color: 'var(--text-tertiary)' }}
                  />
                  Created {formatRelative(root.created_at)}
                </span>
                <span className="inline-flex items-center gap-1.5 font-mono">
                  <Tag
                    className="h-3 w-3"
                    style={{ color: 'var(--text-tertiary)' }}
                  />
                  <RequestIdChip id={requestId} />
                </span>
              </div>
            </div>

            <div className="flex gap-2 items-center">
              <CopyButton text={requestId} label="Copy request ID" />
              <a
                href={`/api/admin/requests/${requestId}/csv`}
                className="inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium transition-colors border"
                style={{
                  borderColor: 'rgba(201, 169, 110, 0.35)',
                  background: 'var(--brand-soft)',
                  color: 'var(--brand)',
                }}
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </a>
            </div>
          </div>

          {/* Big progress strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat
              label="Delivered"
              value={`${delivered_count}`}
              secondary={`of ${target_num_leads} requested`}
              accent={isFulfilled ? 'gold' : 'default'}
              icon={
                <Target
                  className={cn(
                    'h-3.5 w-3.5',
                    isFulfilled ? 'text-gold' : 'text-cream',
                  )}
                />
              }
            />
            <Stat
              label="Submissions"
              value={`${payload.all_submissions_count}`}
              secondary="commits across the chain"
            />
            <Stat
              label="Chain cycles"
              value={`${chain.cycles.length}`}
              secondary={
                chain.cycles.length === 1
                  ? 'single cycle'
                  : `${chain.cycles.length - 1} recycle${chain.cycles.length - 1 === 1 ? '' : 's'}`
              }
            />
            <Stat
              label="Status"
              value={statusLabel(leaf.status)}
              secondary={
                isPartial
                  ? `${target_num_leads - delivered_count} leads still needed`
                  : isFulfilled
                  ? 'Chain complete'
                  : 'In flight'
              }
            />
          </div>
        </div>
      </section>

      {/* Tabs */}
      <div className="flex items-center gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all border',
              tab === t.key
                ? 'bg-gold-tint border-gold-strong text-gold'
                : 'border-white/[0.06] hover-bg-warm text-white/55',
            )}
          >
            {t.label}
            {t.key === 'winners' && (
              <span className="tabular-nums text-[10px] opacity-70">
                {winners.length}
              </span>
            )}
            {t.key === 'chain' && (
              <span className="tabular-nums text-[10px] opacity-70">
                {chain.cycles.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab body */}
      {tab === 'winners' && <WinnersList winners={winners} />}
      {tab === 'icp' && <IcpPanel icp={icp} />}
      {tab === 'chain' && <ChainPanel cycles={chain.cycles} />}
    </div>
  )
}

// =================================================================
// Hero stat tile
// =================================================================

function Stat({
  label,
  value,
  secondary,
  accent,
  icon,
}: {
  label: string
  value: string
  secondary?: string
  accent?: 'gold' | 'default'
  icon?: React.ReactNode
}) {
  return (
    <div
      className="rounded-xl border px-4 py-3.5"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface-elevated)',
      }}
    >
      <div
        className="text-[10px] uppercase tracking-[0.14em] mb-1.5 flex items-center gap-1.5"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {icon}
        {label}
      </div>
      <div
        className={cn(
          'tabular-nums text-xl font-medium leading-none',
          accent === 'gold' ? 'text-gold' : '',
        )}
        style={accent === 'gold' ? undefined : { color: 'var(--text-primary)' }}
      >
        {value}
      </div>
      {secondary && (
        <div
          className="text-[11px] mt-1.5"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {secondary}
        </div>
      )}
    </div>
  )
}

// =================================================================
// Winners tab
// =================================================================
//
// Single component now — the Excel-style table contains both the
// scannable lead columns AND the per-signal Intent Signals column
// (last in the row, wide cell with stacked signal cards). Previously
// the per-signal evidence rendered as a separate "Verified intent
// signals · per lead" section beneath the table; operator feedback
// was that having the evidence inside the row makes it easier to
// audit a lead without scrolling back and forth.

function WinnersList({ winners }: { winners: AdminWinningLead[] }) {
  if (winners.length === 0) {
    return (
      <div
        className="rounded-xl border p-12 text-center"
        style={{
          borderColor: 'var(--surface-border)',
          background: 'var(--surface)',
        }}
      >
        <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          No winning leads yet for this chain.
        </div>
      </div>
    )
  }
  return <WinnersTable winners={winners} />
}

// -----------------------------------------------------------------
// WinnersTable
// -----------------------------------------------------------------
// Column set is fixed by the operator. Total table width sits
// around 3000px, so the wrapper enables horizontal scroll and the
// row-index column is sticky-left so the eye doesn't lose its
// place when scanning right.

interface TableCol {
  key: string
  label: string
  // Tailwind min-width class. Cells wrap when content exceeds it.
  minW: string
  // True for long-form cells where we want soft-wrap with tighter
  // line height (Description, Intent Details).
  longForm?: boolean
  // Render function. Returns a React node, never raw HTML strings.
  cell: (w: AdminWinningLead) => React.ReactNode
}

function dashIfEmpty(v: string | null | undefined): React.ReactNode {
  if (!v) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>
  return v
}

function ExtLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="transition-colors hover:text-gold break-all"
      style={{ color: 'var(--text-primary)' }}
    >
      {children}
    </a>
  )
}

const TABLE_COLUMNS: TableCol[] = [
  {
    key: 'name',
    label: 'Name',
    minW: 'min-w-[180px]',
    cell: (w) => dashIfEmpty(w.lead?.full_name),
  },
  {
    key: 'email',
    label: 'Email',
    minW: 'min-w-[220px]',
    cell: (w) =>
      w.lead?.email ? (
        <ExtLink href={`mailto:${w.lead.email}`}>{w.lead.email}</ExtLink>
      ) : (
        dashIfEmpty(null)
      ),
  },
  {
    key: 'role',
    label: 'Role',
    minW: 'min-w-[170px]',
    cell: (w) => dashIfEmpty(w.lead?.role),
  },
  {
    key: 'company',
    label: 'Company',
    minW: 'min-w-[180px]',
    cell: (w) => dashIfEmpty(w.lead?.business),
  },
  {
    key: 'linkedin',
    label: 'LinkedIn',
    minW: 'min-w-[220px]',
    cell: (w) =>
      w.lead?.linkedin_url ? (
        <ExtLink href={w.lead.linkedin_url}>{w.lead.linkedin_url}</ExtLink>
      ) : (
        dashIfEmpty(null)
      ),
  },
  {
    key: 'website',
    label: 'Website',
    minW: 'min-w-[220px]',
    cell: (w) =>
      w.lead?.company_website ? (
        <ExtLink href={w.lead.company_website}>{w.lead.company_website}</ExtLink>
      ) : (
        dashIfEmpty(null)
      ),
  },
  {
    key: 'company_linkedin',
    label: 'Company LinkedIn',
    minW: 'min-w-[220px]',
    cell: (w) =>
      w.lead?.company_linkedin ? (
        <ExtLink href={w.lead.company_linkedin}>{w.lead.company_linkedin}</ExtLink>
      ) : (
        dashIfEmpty(null)
      ),
  },
  {
    key: 'industry',
    label: 'Industry',
    minW: 'min-w-[140px]',
    cell: (w) => dashIfEmpty(w.lead?.industry),
  },
  {
    key: 'sub_industry',
    label: 'Sub Industry',
    minW: 'min-w-[140px]',
    cell: (w) => dashIfEmpty(w.lead?.sub_industry),
  },
  {
    key: 'city',
    label: 'City',
    minW: 'min-w-[120px]',
    cell: (w) => dashIfEmpty(w.lead?.city),
  },
  {
    key: 'state',
    label: 'State',
    minW: 'min-w-[120px]',
    cell: (w) => dashIfEmpty(w.lead?.state),
  },
  {
    key: 'country',
    label: 'Country',
    minW: 'min-w-[120px]',
    cell: (w) => dashIfEmpty(w.lead?.country),
  },
  {
    key: 'hq_state',
    label: 'HQ State',
    minW: 'min-w-[120px]',
    cell: (w) => dashIfEmpty(w.lead?.company_hq_state),
  },
  {
    key: 'hq_country',
    label: 'HQ Country',
    minW: 'min-w-[120px]',
    cell: (w) => dashIfEmpty(w.lead?.company_hq_country),
  },
  {
    key: 'employee_count',
    label: 'Employee Count',
    minW: 'min-w-[110px]',
    cell: (w) => dashIfEmpty(w.lead?.employee_count),
  },
  {
    key: 'description',
    label: 'Description',
    minW: 'min-w-[320px]',
    longForm: true,
    cell: (w) => dashIfEmpty(w.lead?.description),
  },
  {
    key: 'intent_details',
    label: 'Intent Details',
    minW: 'min-w-[340px]',
    longForm: true,
    cell: (w) => dashIfEmpty(w.consensus.intent_details),
  },
  {
    key: 'phone',
    label: 'Phone',
    minW: 'min-w-[140px]',
    cell: (w) => dashIfEmpty(w.lead?.phone ?? null),
  },
  {
    // Per-signal evidence used to render in a separate card section
    // below the table. Operator wanted it inline with the row so each
    // winning lead is fully auditable on a single horizontal scroll.
    // The cell stacks one signal block per credited signal, each with:
    //   - source pill + date + score
    //   - matched ICP signal label
    //   - LLM-written per-signal description (or raw description as
    //     fallback before migration 16 / before backfill runs)
    //   - expandable raw evidence snippet
    //   - clickable source URL
    key: 'intent_signals',
    label: 'Intent Signals',
    minW: 'min-w-[440px]',
    longForm: true,
    cell: (w) => {
      const credited = creditedSignals(w.consensus.intent_signal_mapping)
      if (credited.length === 0) return dashIfEmpty(null)
      return (
        <IntentSignalsList
          mapping={w.consensus.intent_signal_mapping}
          breakdown={w.consensus.intent_breakdown}
        />
      )
    },
  },
]

function WinnersTable({ winners }: { winners: AdminWinningLead[] }) {
  return (
    <section
      className="rounded-xl border overflow-hidden"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface)',
      }}
    >
      <header
        className="flex items-center justify-between gap-4 border-b px-5 py-3.5"
        style={{ borderColor: 'var(--surface-border)' }}
      >
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Winning leads
          </h2>
          <span className="tabular-nums text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {winners.length}
          </span>
        </div>
        <span
          className="hidden sm:inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em]"
          style={{ color: 'var(--text-tertiary)' }}
        >
          <ChevronRight className="h-3 w-3" /> Scroll horizontally for more
        </span>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr style={{ background: 'var(--surface-elevated)' }}>
              <th
                scope="col"
                className="sticky left-0 z-10 px-3 py-2.5 text-left text-[10px] uppercase tracking-[0.14em] font-medium border-b border-r whitespace-nowrap"
                style={{
                  background: 'var(--surface-elevated)',
                  borderColor: 'var(--surface-border)',
                  color: 'var(--text-tertiary)',
                  minWidth: '44px',
                  width: '44px',
                }}
              >
                #
              </th>
              {TABLE_COLUMNS.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={cn(
                    'px-3 py-2.5 text-left text-[10px] uppercase tracking-[0.14em] font-medium border-b whitespace-nowrap',
                    col.minW,
                  )}
                  style={{
                    background: 'var(--surface-elevated)',
                    borderColor: 'var(--surface-border)',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {winners.map((w, idx) => (
              <tr key={w.consensus.consensus_id} className="hover-bg-warm transition-colors">
                <td
                  className="sticky left-0 z-[5] px-3 py-3 border-b border-r tabular-nums text-xs align-top"
                  style={{
                    background: 'var(--surface)',
                    borderColor: 'var(--surface-border)',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  {idx + 1}
                </td>
                {TABLE_COLUMNS.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      'px-3 py-3 border-b align-top',
                      col.longForm
                        ? 'text-[12px] leading-relaxed whitespace-pre-line'
                        : 'whitespace-normal break-words',
                      col.minW,
                    )}
                    style={{
                      borderColor: 'var(--surface-border)',
                      color: 'var(--text-primary)',
                      maxWidth: col.longForm ? '420px' : '280px',
                    }}
                  >
                    {col.cell(w)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// -----------------------------------------------------------------
// PerLeadIntentSignals
// -----------------------------------------------------------------
// IntentSignalsList
// -----------------------------------------------------------------
// Renders the credited intent signals for a single winning lead as a
// stack of compact cards. Used inside the "Intent Signals" column of
// WinnersTable so the evidence ships next to the lead row instead of
// in a separate section below the table. Returns null when no signal
// earned credit (the calling cell substitutes a dash so the column
// still renders consistently).
function IntentSignalsList({
  mapping,
  breakdown,
}: {
  mapping: IntentSignalMappingEntry[] | null
  breakdown: IntentBreakdown | null
}) {
  const credited = creditedSignals(mapping)
  if (credited.length === 0) return null
  const breakdownByIdx = new Map<number, string>()
  for (const b of breakdown?.per_signal ?? []) {
    if (typeof b.source_index === 'number' && b.details) {
      breakdownByIdx.set(b.source_index, b.details)
    }
  }
  return (
    <div className="space-y-3">
      {credited.map((s, i) => {
        const breakdownText = breakdownByIdx.get(i)
        const sourceLabel = s.source || 'web'
        const matched = s.matched_icp_signal
        return (
          <div
            key={`${s.url}-${i}`}
            className="rounded-lg border px-4 py-3.5 space-y-2"
            style={{
              borderColor: 'var(--surface-border)',
              background: 'var(--surface-elevated)',
            }}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] rounded-full px-2 py-0.5 border"
                style={{
                  borderColor: 'var(--surface-border-strong)',
                  color: 'var(--text-secondary)',
                }}
              >
                {sourceLabel}
              </span>
              {s.date && (
                <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  {s.date}
                </span>
              )}
              {typeof s.after_decay_score === 'number' && (
                <span
                  className="text-[11px] tabular-nums ml-auto"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <span style={{ color: 'var(--text-tertiary)' }}>score</span>{' '}
                  {s.after_decay_score.toFixed(1)}
                </span>
              )}
            </div>
            {matched && (
              <div className="text-xs italic" style={{ color: 'var(--text-secondary)' }}>
                Matches ICP signal: &ldquo;{matched}&rdquo;
              </div>
            )}
            {(breakdownText || s.description) && (
              <div className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                {breakdownText || s.description}
              </div>
            )}
            {s.snippet && (
              <details className="text-xs">
                <summary
                  className="cursor-pointer transition-colors hover:text-gold inline-flex items-center gap-1"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  <ChevronRight className="h-3 w-3" />
                  Raw evidence
                </summary>
                <p
                  className="mt-2 pl-4 leading-relaxed whitespace-pre-line"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {s.snippet}
                </p>
              </details>
            )}
            {s.url && (
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] transition-colors hover:text-gold truncate max-w-full"
                style={{ color: 'var(--text-tertiary)' }}
              >
                <Globe className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{s.url}</span>
              </a>
            )}
          </div>
        )
      })}
    </div>
  )
}


// =================================================================
// ICP tab
// =================================================================

function IcpPanel({ icp }: { icp: IcpDetails | null }) {
  if (!icp) {
    return (
      <div
        className="rounded-xl border p-12 text-center"
        style={{
          borderColor: 'var(--surface-border)',
          background: 'var(--surface)',
        }}
      >
        <div
          className="text-sm"
          style={{ color: 'var(--text-secondary)' }}
        >
          No ICP details on file for this request.
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {icp.prompt && (
        <FieldGroup title="Buyer profile">
          <p
            className="text-sm leading-relaxed whitespace-pre-line"
            style={{ color: 'var(--text-primary)' }}
          >
            {icp.prompt}
          </p>
        </FieldGroup>
      )}
      {icp.product_service && (
        <FieldGroup title="Product / service">
          <p
            className="text-sm leading-relaxed whitespace-pre-line"
            style={{ color: 'var(--text-primary)' }}
          >
            {icp.product_service}
          </p>
        </FieldGroup>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FieldGroup title="Targeting">
          <Field label="Industries" value={asList(icp.industry).join(', ')} />
          <Field
            label="Sub-industries"
            value={asList(icp.sub_industry).join(', ')}
          />
          <Field
            label="Countries"
            value={asList(icp.country).join(', ') || 'Any'}
          />
          {icp.geography && <Field label="Geography" value={icp.geography} />}
          <Field
            label="Employee count"
            value={asList(icp.employee_count).join(', ')}
          />
        </FieldGroup>
        <FieldGroup title="Buyer roles">
          <Field
            label="Target roles"
            value={(icp.target_roles ?? []).join(', ')}
          />
          <Field
            label="Role types"
            value={(icp.target_role_types ?? []).join(', ')}
          />
          {icp.target_seniority && (
            <Field label="Seniority" value={icp.target_seniority} />
          )}
        </FieldGroup>
      </div>
      <FieldGroup title="Intent signals requested">
        <ul className="space-y-1.5 text-sm">
          {icpSignals(icp).map((s, i) => (
            <li
              key={i}
              className="flex gap-2 items-start"
              style={{ color: 'var(--text-primary)' }}
            >
              <span
                className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] flex-shrink-0 mt-0.5 border"
                style={{
                  borderColor: 'var(--surface-border-strong)',
                  background: 'var(--surface-elevated)',
                  color: 'var(--text-secondary)',
                }}
              >
                {i + 1}
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
      </FieldGroup>
      {(icp.excluded_companies ?? []).length > 0 && (
        <FieldGroup title="Excluded companies">
          <div className="flex flex-wrap gap-1.5">
            {(icp.excluded_companies ?? []).map((c, i) => (
              <span
                key={i}
                className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]"
                style={{
                  borderColor: 'var(--surface-border-strong)',
                  background: 'var(--surface-elevated)',
                  color: 'var(--text-secondary)',
                }}
              >
                {c}
              </span>
            ))}
          </div>
        </FieldGroup>
      )}
    </div>
  )
}

// =================================================================
// Chain history tab
// =================================================================

function ChainPanel({ cycles }: { cycles: AdminFulfillmentRequest[] }) {
  return (
    <div className="space-y-2">
      {cycles.map((c, i) => (
        <div
          key={c.request_id}
          className="rounded-xl border p-4 flex items-center gap-4"
          style={{
            borderColor: 'var(--surface-border)',
            background:
              i === cycles.length - 1
                ? 'var(--surface-elevated)'
                : 'var(--surface)',
          }}
        >
          <div
            className="flex items-center justify-center w-7 h-7 rounded-full text-xs border tabular-nums flex-shrink-0"
            style={{
              borderColor:
                i === cycles.length - 1
                  ? 'rgba(201, 169, 110, 0.45)'
                  : 'var(--surface-border-strong)',
              background:
                i === cycles.length - 1
                  ? 'rgba(201, 169, 110, 0.12)'
                  : 'transparent',
              color:
                i === cycles.length - 1
                  ? 'var(--brand)'
                  : 'var(--text-secondary)',
            }}
          >
            {i + 1}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <StatusPill status={c.status} />
              <span
                className="text-xs tabular-nums"
                style={{ color: 'var(--text-secondary)' }}
              >
                {c.num_leads} leads
              </span>
              <span
                className="text-xs"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {formatDateTime(c.created_at)}
              </span>
            </div>
            <div
              className="font-mono text-[11px] mt-1 truncate"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {c.request_id}
            </div>
          </div>
          {i === 0 && (
            <span
              className="text-[10px] uppercase tracking-[0.14em] inline-flex items-center gap-1 rounded-full border px-2 py-1"
              style={{
                borderColor: 'var(--surface-border-strong)',
                color: 'var(--text-secondary)',
              }}
            >
              Root
            </span>
          )}
          {i === cycles.length - 1 && cycles.length > 1 && (
            <span
              className="text-[10px] uppercase tracking-[0.14em] text-gold inline-flex items-center gap-1 rounded-full border border-gold-soft bg-gold-soft px-2 py-1"
            >
              Current
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

// =================================================================
// Shared field primitives
// =================================================================

function FieldGroup({
  title,
  accentIcon,
  children,
}: {
  title: string
  accentIcon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section
      className="rounded-xl border p-4"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface-elevated)',
      }}
    >
      <div
        className="text-[10px] uppercase tracking-[0.14em] mb-3 flex items-center gap-1.5"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {accentIcon}
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function Field({
  label,
  value,
  link,
  icon,
  mono,
  copy,
}: {
  label: string
  value?: string
  link?: string
  icon?: React.ReactNode
  mono?: boolean
  copy?: string
}) {
  const empty = !value
  return (
    <div className="flex items-baseline gap-3 text-sm">
      <span
        className="text-[11px] uppercase tracking-[0.10em] flex-shrink-0 w-28"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {label}
      </span>
      <div className="min-w-0 flex-1 flex items-center gap-1.5">
        {icon && <span style={{ color: 'var(--text-tertiary)' }}>{icon}</span>}
        {empty ? (
          <span style={{ color: 'var(--text-tertiary)' }}>—</span>
        ) : link ? (
          <a
            href={link}
            target={link.startsWith('mailto:') ? undefined : '_blank'}
            rel="noopener noreferrer"
            className={cn(
              'truncate transition-colors hover:text-gold',
              mono ? 'font-mono text-[12px]' : '',
            )}
            style={{ color: 'var(--text-primary)' }}
          >
            {value}
          </a>
        ) : (
          <span
            className={cn(
              'truncate',
              mono ? 'font-mono text-[12px] tabular-nums' : '',
            )}
            style={{ color: 'var(--text-primary)' }}
          >
            {value}
          </span>
        )}
        {copy && <CopyButton text={copy} compact />}
      </div>
    </div>
  )
}

function CheckRow({
  label,
  passed,
}: {
  label: string
  passed: boolean | null | undefined
}) {
  const color =
    passed === true
      ? 'text-gold'
      : passed === false
      ? 'text-burgundy'
      : 'text-white/40'
  return (
    <div className="flex items-center gap-3 text-sm">
      <span
        className="text-[11px] uppercase tracking-[0.10em] flex-shrink-0 w-28"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {label}
      </span>
      <div className={cn('inline-flex items-center gap-1.5', color)}>
        {passed === true ? (
          <>
            <Check className="h-3 w-3" />
            <span className="text-xs">Pass</span>
          </>
        ) : passed === false ? (
          <>
            <span className="text-xs">Fail</span>
          </>
        ) : (
          <span className="text-xs">—</span>
        )}
      </div>
    </div>
  )
}

function CopyButton({
  text,
  label,
  compact,
}: {
  text: string
  label?: string
  compact?: boolean
}) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
      className={cn(
        'inline-flex items-center gap-1.5 transition-colors hover:text-gold',
        compact
          ? 'text-[10px] opacity-60 hover:opacity-100'
          : 'rounded-md border px-3 py-2 text-xs',
      )}
      style={
        compact
          ? { color: 'var(--text-tertiary)' }
          : {
              borderColor: 'var(--surface-border)',
              background: 'var(--surface-elevated)',
              color: 'var(--text-secondary)',
            }
      }
      title={label || 'Copy'}
    >
      {copied ? (
        <>
          <Check className="h-3 w-3" />
          {!compact && 'Copied'}
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          {!compact && label}
        </>
      )}
    </button>
  )
}

function RequestIdChip({ id }: { id: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[11px]"
      style={{ color: 'var(--text-secondary)' }}
    >
      {id.slice(0, 8)}…{id.slice(-4)}
    </span>
  )
}

function StatusPill({ status }: { status: string }) {
  const tone = statusTone(status)
  const cls =
    tone === 'fulfilled'
      ? 'bg-gold-soft border-gold-soft text-gold'
      : tone === 'open'
      ? 'bg-cream-soft border-cream-soft text-cream'
      : tone === 'pending'
      ? 'bg-amber-warm-soft border-amber-warm-soft text-amber-warm'
      : tone === 'partial'
      ? 'bg-amber-warm-soft border-amber-warm-soft text-amber-warm'
      : tone === 'recycled'
      ? 'bg-burgundy-soft border-burgundy-soft text-burgundy'
      : 'border border-white/10 text-white/60'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] font-medium',
        cls,
      )}
    >
      {statusLabel(status)}
    </span>
  )
}
