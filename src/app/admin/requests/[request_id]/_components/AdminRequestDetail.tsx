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
  Sparkles,
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
  formatScore,
  formatRewardPct,
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
        <div
          className="text-sm"
          style={{ color: 'var(--text-secondary)' }}
        >
          No winning leads yet for this chain.
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {winners.map((w, i) => (
        <WinnerCard key={w.consensus.consensus_id} winner={w} rank={i + 1} />
      ))}
    </div>
  )
}

function WinnerCard({
  winner,
  rank,
}: {
  winner: AdminWinningLead
  rank: number
}) {
  const [expanded, setExpanded] = useState(rank === 1)
  const { consensus, lead } = winner

  // Compose the location string from the best available fields.
  // company_hq_* is where the LEAD is anchored; city/state/country
  // is where the PERSON is. We surface both.
  const personLoc = [lead?.city, lead?.state, lead?.country]
    .filter(Boolean)
    .join(', ')
  const companyLoc = [
    lead?.company_hq_city,
    lead?.company_hq_state,
    lead?.company_hq_country,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <div
      className="rounded-xl border overflow-hidden card-lift"
      style={{
        borderColor: 'var(--surface-border)',
        background: 'var(--surface)',
      }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-5 py-4 hover-bg-warm transition-colors"
      >
        <div className="flex items-start gap-4">
          <div
            className="flex-shrink-0 mt-0.5 flex items-center justify-center rounded-full w-6 h-6 text-[10px] font-medium border"
            style={{
              borderColor:
                rank === 1
                  ? 'rgba(201, 169, 110, 0.45)'
                  : 'var(--surface-border-strong)',
              background:
                rank === 1
                  ? 'rgba(201, 169, 110, 0.16)'
                  : 'var(--surface-elevated)',
              color: rank === 1 ? '#c9a96e' : 'var(--text-secondary)',
            }}
          >
            {rank === 1 ? <Crown className="h-3 w-3" /> : rank}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h3
                className="font-medium truncate"
                style={{ color: 'var(--text-primary)' }}
              >
                {lead?.business || (
                  <span style={{ color: 'var(--text-tertiary)' }}>
                    (no business name)
                  </span>
                )}
              </h3>
              {lead?.industry && (
                <span
                  className="text-[11px]"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {lead.industry}
                  {lead.sub_industry ? ` · ${lead.sub_industry}` : ''}
                </span>
              )}
            </div>
            <div
              className="mt-1 flex items-center gap-x-3 gap-y-1 text-xs flex-wrap"
              style={{ color: 'var(--text-secondary)' }}
            >
              {lead?.full_name && (
                <span className="inline-flex items-center gap-1.5">
                  <User className="h-3 w-3 opacity-70" />
                  {lead.full_name}
                  {lead.role ? <span className="opacity-60">· {lead.role}</span> : null}
                </span>
              )}
              {lead?.email && (
                <a
                  href={`mailto:${lead.email}`}
                  className="inline-flex items-center gap-1.5 hover:text-gold transition-colors truncate"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Mail className="h-3 w-3 opacity-70" />
                  {lead.email}
                </a>
              )}
              {(personLoc || companyLoc) && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3 w-3 opacity-70" />
                  {personLoc || companyLoc}
                </span>
              )}
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-4 flex-shrink-0">
            <div className="text-right">
              <div
                className="text-[10px] uppercase tracking-[0.14em]"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Score
              </div>
              <div
                className="text-sm font-medium tabular-nums"
                style={{ color: 'var(--text-primary)' }}
              >
                {formatScore(consensus.consensus_final_score)}
              </div>
            </div>
            <div className="text-right">
              <div
                className="text-[10px] uppercase tracking-[0.14em]"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Reward
              </div>
              <div className="text-sm font-medium tabular-nums text-gold">
                {formatRewardPct(consensus.reward_pct)}
              </div>
            </div>
          </div>
          <ChevronDown
            className={cn(
              'h-4 w-4 flex-shrink-0 transition-transform mt-1',
              expanded && 'rotate-180',
            )}
            style={{ color: 'var(--text-tertiary)' }}
          />
        </div>
      </button>

      {expanded && (
        <div
          className="border-t px-5 py-5 space-y-5"
          style={{ borderColor: 'var(--surface-border)' }}
        >
          {/* Lead body */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 space-y-4">
              <FieldGroup title="Lead">
                <Field label="Business" value={lead?.business} />
                <Field label="Industry" value={[lead?.industry, lead?.sub_industry].filter(Boolean).join(' · ')} />
                <Field label="Employee count" value={lead?.employee_count} />
                <Field
                  label="HQ"
                  value={companyLoc || undefined}
                />
                <Field
                  label="Website"
                  value={lead?.company_website}
                  link={lead?.company_website}
                  icon={<Globe className="h-3 w-3" />}
                />
                <Field
                  label="Company LinkedIn"
                  value={lead?.company_linkedin}
                  link={lead?.company_linkedin}
                  icon={<Linkedin className="h-3 w-3" />}
                />
              </FieldGroup>
              <FieldGroup title="Contact">
                <Field label="Name" value={lead?.full_name} />
                <Field label="Role" value={lead?.role} />
                <Field
                  label="Type · seniority"
                  value={[lead?.role_type, lead?.seniority].filter(Boolean).join(' · ')}
                />
                <Field
                  label="Email"
                  value={lead?.email}
                  link={lead?.email ? `mailto:${lead.email}` : undefined}
                  icon={<Mail className="h-3 w-3" />}
                />
                <Field
                  label="Phone"
                  value={lead?.phone || undefined}
                />
                <Field
                  label="LinkedIn"
                  value={lead?.linkedin_url}
                  link={lead?.linkedin_url}
                  icon={<Linkedin className="h-3 w-3" />}
                />
                <Field
                  label="Location"
                  value={personLoc || undefined}
                />
              </FieldGroup>
              {lead?.description && (
                <FieldGroup title="Company description">
                  <p
                    className="text-sm leading-relaxed whitespace-pre-line"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {lead.description}
                  </p>
                </FieldGroup>
              )}
            </div>

            <div className="space-y-4">
              <FieldGroup title="Scoring">
                <Field
                  label="Final score"
                  value={formatScore(consensus.consensus_final_score)}
                  mono
                />
                <Field
                  label="Intent signal"
                  value={formatScore(consensus.consensus_intent_signal_final)}
                  mono
                />
                <Field
                  label="Rep score"
                  value={formatScore(consensus.consensus_rep_score, 0)}
                  mono
                />
                <Field
                  label="Reward / epoch"
                  value={formatRewardPct(consensus.reward_pct)}
                  mono
                />
                <Field
                  label="Validators"
                  value={consensus.num_validators?.toString()}
                  mono
                />
                <Field
                  label="Computed"
                  value={formatDateTime(consensus.computed_at)}
                />
              </FieldGroup>
              <FieldGroup title="Verification">
                <CheckRow label="ICP fit (Tier 1)" passed={consensus.consensus_icp_fit} />
                <CheckRow label="Tier 2 (data accuracy)" passed={consensus.consensus_tier2_passed} />
                <CheckRow label="Email" passed={consensus.consensus_email_verified} />
                <CheckRow label="Person (LinkedIn)" passed={consensus.consensus_person_verified} />
                <CheckRow label="Company" passed={consensus.consensus_company_verified} />
                <CheckRow label="Decision-maker" passed={consensus.consensus_decision_maker} />
              </FieldGroup>
              <FieldGroup title="Source">
                <Field
                  label="Miner"
                  value={shortHotkey(consensus.miner_hotkey)}
                  copy={consensus.miner_hotkey}
                  mono
                />
                <Field
                  label="Lead ID"
                  value={consensus.lead_id.slice(0, 8) + '…'}
                  copy={consensus.lead_id}
                  mono
                />
              </FieldGroup>
            </div>
          </div>

          {/* Intent details + breakdown */}
          {consensus.intent_details && (
            <FieldGroup
              title="Intent details (client-facing)"
              accentIcon={<Sparkles className="h-3 w-3 text-gold" />}
            >
              <p
                className="text-sm leading-relaxed whitespace-pre-line"
                style={{ color: 'var(--text-primary)' }}
              >
                {consensus.intent_details}
              </p>
            </FieldGroup>
          )}

          <IntentSignalsPanel
            mapping={consensus.intent_signal_mapping}
            breakdown={consensus.intent_breakdown}
          />
        </div>
      )}
    </div>
  )
}

function IntentSignalsPanel({
  mapping,
  breakdown,
}: {
  mapping: IntentSignalMappingEntry[] | null
  breakdown: IntentBreakdown | null
}) {
  const credited = creditedSignals(mapping)
  if (credited.length === 0) return null
  // Index per_signal entries by source_index so we can pair the
  // detailed paragraph with the underlying mapping.
  const breakdownByIdx = new Map<number, string>()
  for (const b of breakdown?.per_signal ?? []) {
    if (typeof b.source_index === 'number' && b.details) {
      breakdownByIdx.set(b.source_index, b.details)
    }
  }
  return (
    <FieldGroup
      title="Verified intent signals"
      accentIcon={<Sparkles className="h-3 w-3 text-gold" />}
    >
      <div className="space-y-3">
        {credited.map((s, i) => {
          const sourceIdx = i // mapping is dense for credited slots
          const breakdownText = breakdownByIdx.get(sourceIdx)
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
                  <span
                    className="text-[11px]"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {s.date}
                  </span>
                )}
                {typeof s.after_decay_score === 'number' && (
                  <span
                    className="text-[11px] tabular-nums ml-auto"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <span style={{ color: 'var(--text-tertiary)' }}>
                      score
                    </span>{' '}
                    {s.after_decay_score.toFixed(1)}
                  </span>
                )}
              </div>
              {matched && (
                <div
                  className="text-xs italic"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Matches ICP signal: &ldquo;{matched}&rdquo;
                </div>
              )}
              {(breakdownText || s.description) && (
                <div
                  className="text-sm leading-relaxed"
                  style={{ color: 'var(--text-primary)' }}
                >
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
                  className="inline-flex items-center gap-1 text-[11px] transition-colors hover:text-gold truncate"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  <Globe className="h-3 w-3" />
                  <span className="truncate">{s.url}</span>
                </a>
              )}
            </div>
          )
        })}
      </div>
    </FieldGroup>
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
