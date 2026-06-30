'use client'

import { useState, useId, useEffect, useCallback } from 'react'
import {
  ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// =================================================================
//  FAQ. Premium editorial layout.
//
//  Positioning: Leadpoet is reimagining how sales intelligence is
//  produced. Live fulfillment on a Bittensor subnet replaces the
//  static-list / single-vendor status quo. Alpha is the access token.
//  Sales lead generation is the first deployment of a framework that
//  extends to any matching problem with verifiable quality.
//
//  Visual language matches Fulfillment: warm off-black canvas, single
//  gold accent, restrained palette.
//  Flat list (no category sections, no search, no share UI). There
//  aren't enough questions to justify the chrome, and each answer
//  is meant to be read on its own.
// =================================================================

interface FAQItem {
  id: string
  question: string
  /**
   * Answer rendered as plain text. We split on `\n\n` for paragraph
   * breaks at render time so the data stays readable inline.
   */
  answer: string
}

const FAQ_DATA: FAQItem[] = [
  {
    id: 'problem',
    question: 'What problem does Leadpoet solve?',
    answer:
      "Sales runs on fragmented tools and stale, generic data. The lead lists teams buy are sold to thousands of competitors at once, scored by proprietary algorithms nobody can audit, and out of date before anyone reaches out. Worse, none of it compounds: every vendor is a static point solution that never really gets smarter.\n\nLeadpoet rebuilds the layer underneath. We're training a specialized sales intelligence, a sales brain, and the best autonomous sales agent built on top of it. Sales is, at its core, a continuously evolving matching problem with measurable outcomes, which makes it ideal to train against. An open market of contributors competes to produce better results, every output is verified before it ships, and each one makes the model sharper. Lead generation is where we start. The goal is the entire sales motion.",
  },
  {
    id: 'why-bittensor',
    question: 'Why Bittensor?',
    answer:
      "Bittensor turns useful work into an open incentive market: anyone can contribute, and emissions flow to whoever produces the best verified output. Sales is unusually measurable. Did the contact exist, did the email land, did the prospect reply, did the deal close. Because the work can be scored honestly, the incentive can't be gamed.\n\nThat makes it the right substrate for building a sales brain. Instead of one company training a model behind closed doors, an open network of contributors competes every cycle to push the agent's data, fit, and verification forward, and the same work generates the labeled data that trains the model. No single lab could assemble that breadth of real-world sales signal alone.",
  },
  {
    id: 'how-it-works',
    question: 'How does the subnet actually work?',
    answer:
      "The subnet runs on two tracks. Fulfillment is where it produces economic output. When a sales team submits a request, miners compete in real time to source leads that match the request's criteria, including industry, role, geography, company size, and intent signals. Validators score and verify every submission, so only the leads that pass quality checks and fit best reach the sales team. That creates a live market around each request instead of a static list sold over and over again.\n\nThe Research Lab is the second track. Miners direct and fund automated research loops that work to improve Leadpoet's sales agent, with every improvement scored against a shared benchmark. The engine behind every request keeps getting better over time, and the same work generates data to train a state-of-the-art sales LLM.",
  },
  {
    id: 'fulfillment',
    question: 'How does fulfillment work?',
    answer:
      "A sales team submits a request with the criteria they care about: industry, role, geography, headcount, and intent signals to prioritize. Miners source matching leads in real time, then validators score every submission on ICP fit, decision-maker accuracy, intent signal strength, and integrity.\n\nValidators also verify the underlying facts: company identity, contact existence, email deliverability, employment status, and intent scoring. Only leads that survive those checks reach the sales team, and the miners whose leads were chosen are compensated for them. Incumbents work the opposite way: they give you stale data from months ago and leave filtering and qualifying to you.",
  },
  {
    id: 'research-lab',
    question: 'How does the Research Lab work?',
    answer:
      "The Research Lab is where Leadpoet pushes the frontier of sales intelligence. Miners direct and fund automated research loops: they provide compute, choose a research direction, and run experiments that make Leadpoet's sales agent smarter. Every improvement is scored against a shared benchmark, so progress stays open, measurable, and relentless.\n\nThis is how the best sales agent in the world gets built, in the open. The agent sharpens with every loop, miners are rewarded for the gains they unlock, and each experiment leaves behind a growing, labeled corpus of real sales research. That corpus is the foundation for training state-of-the-art sales models. We improve what ships today and compound the data advantage behind everything we build next.",
  },
  {
    id: 'incentives',
    question: 'How does the incentive mechanism work?',
    answer:
      "Rewards follow verified value, on both tracks. In Fulfillment, miners earn when their leads pass every data-quality and intent check and rank highest for a live request. Validators handle scoring, and the leads that win are the ones that get paid. In the Research Lab, contributors are rewarded when their experiments measurably improve the sales agent against a shared benchmark.\n\nThat keeps every incentive pointed at the same goal: a sharper sales brain and a better agent. Fresher data, tighter fit, stronger signal, and real model gains are what move the market. And because outcomes are measured, the network can't reward anything that doesn't actually work.",
  },
  {
    id: 'alpha',
    question: 'What role will Alpha play?',
    answer:
      "Alpha will gate access to the subnet's outputs. If a platform wants to tap into Leadpoet's intelligence, they'll have to leverage Alpha.\n\nThis is the cleanest design of subnet utility that can be built. More teams pulling outputs means more Alpha spent, which routes more emissions to miners, which attracts better fulfillment, improves the outputs, and brings in more teams.",
  },
  {
    id: 'beyond-sales',
    question: "What's beyond sales?",
    answer:
      "First, the whole of sales. Lead generation is the entry point, but the same engine extends across the entire sales motion: sourcing, qualification, account expansion, timing, and outreach, all powered by the sales brain we're training and the agent built on it.\n\nBeyond sales, the architecture isn't sales-specific. Live request fulfillment, verifiable quality, and a model that learns from measured outcomes apply to any matching problem: talent acquisition, M&A sourcing, procurement, investment research, partnership development. Each is the same shape with the same brittle incumbents.\n\nEvery new domain plugs into the same trust infrastructure, validator network, and Alpha economy, deepening the flywheel for everything already on the subnet. Over time, other Bittensor subnets and applications build directly on Leadpoet's outputs, making Leadpoet infrastructure for an entire class of intent-driven products, not just one of them.",
  },
]

/** When true, multiple FAQ items can be open simultaneously. */
const ALLOW_MULTIPLE_OPEN = false

/* ============================================================
 * Helpers
 * ============================================================ */

/** Compose Google FAQPage schema for SEO discoverability. */
function buildFaqSchema(items: FAQItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        // Strip paragraph breaks for the schema payload, which keeps
        // the rich snippet text clean in search results.
        text: item.answer.replace(/\n\n/g, ' '),
      },
    })),
  }
}

const FAQ_SCHEMA_JSON = JSON.stringify(buildFaqSchema(FAQ_DATA))

/* ============================================================
 * Main component
 * ============================================================ */

export function FAQ() {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set([FAQ_DATA[0]?.id ?? '']))

  // Hash-based deep linking is still supported (e.g. ?tab=faq#alpha)
  // but no share UI is exposed inside the FAQ.
  useEffect(() => {
    const handleHash = () => {
      const id = window.location.hash.replace(/^#/, '')
      if (!id) return
      const target = FAQ_DATA.find((f) => f.id === id)
      if (!target) return
      setOpenIds(new Set([id]))
      window.setTimeout(() => {
        const el = document.getElementById(`faq-row-${id}`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 80)
    }
    handleHash()
    window.addEventListener('hashchange', handleHash)
    return () => window.removeEventListener('hashchange', handleHash)
  }, [])

  const toggleItem = useCallback((id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        if (!ALLOW_MULTIPLE_OPEN) next.clear()
        next.add(id)
      }
      return next
    })
  }, [])

  return (
    <div className="max-w-6xl mx-auto">
      {/* Structured data for SEO (Google FAQPage rich snippet) */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: FAQ_SCHEMA_JSON }}
      />

      {/* ════════════════════════════════════════════════════════════
          Hero: overline + title + subtitle
          ════════════════════════════════════════════════════════════ */}
      <header className="mb-6 md:mb-8">
        <h2 className="text-2xl md:text-3xl font-semibold text-slate-100 tracking-tight">
          Frequently asked questions
        </h2>
        <p className="text-sm text-slate-400 mt-1.5 max-w-2xl">
          The future of sales intelligence, powered by Bittensor.
        </p>
      </header>

      {/* ════════════════════════════════════════════════════════════
          Body: two-column on lg+, single column on mobile.
          Left: flat accordion. Right: sidebar with about + links.
          ════════════════════════════════════════════════════════════ */}
      <div className="grid lg:grid-cols-[1fr_280px] gap-6 lg:gap-8">
        <div className="rounded-xl border border-slate-800/70 bg-slate-950/40 overflow-hidden divide-y divide-slate-800/60">
          {FAQ_DATA.map((item) => (
            <FAQAccordionItem
              key={item.id}
              item={item}
              isOpen={openIds.has(item.id)}
              onToggle={() => toggleItem(item.id)}
            />
          ))}
        </div>

        <aside>
          <Sidebar />
        </aside>
      </div>

      <ContactBlock />
    </div>
  )
}

/* ============================================================
 * FAQAccordionItem. Single question/answer row.
 *
 * Share-link UI removed by request. Hash deep linking still works
 * because the wrapping div keeps its `id={faq-row-${id}}` anchor.
 * ============================================================ */
function FAQAccordionItem({
  item,
  isOpen,
  onToggle,
}: {
  item: FAQItem
  isOpen: boolean
  onToggle: () => void
}) {
  const contentId = useId()
  const buttonId = useId()
  const paragraphs = item.answer.split(/\n\n+/)

  return (
    <div className="group relative" id={`faq-row-${item.id}`}>
      <button
        id={buttonId}
        type="button"
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={onToggle}
        className={cn(
          'w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors duration-200',
          'focus:outline-none focus-visible:bg-[rgba(236,234,230,0.04)]',
          'motion-reduce:transition-none',
          isOpen ? 'bg-[rgba(232,240,255,0.03)]' : 'hover-bg-warm'
        )}
      >
        <span
          className={cn(
            'flex items-center justify-center w-6 h-6 rounded-md flex-shrink-0 transition-colors duration-200 motion-reduce:transition-none',
            isOpen
              ? 'bg-[rgba(232,240,255,0.1)] text-[var(--white)]'
              : 'bg-[rgba(236,234,230,0.04)] text-[var(--muted-2)] group-hover:text-[var(--muted)]'
          )}
          aria-hidden
        >
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none',
              isOpen && 'rotate-180'
            )}
          />
        </span>

        <span
          className={cn(
            'flex-1 text-[14px] leading-snug transition-colors duration-200 min-w-0',
            isOpen ? 'text-[var(--white)] font-medium' : 'text-[var(--platinum)] group-hover:text-[var(--white)]'
          )}
        >
          {item.question}
        </span>
      </button>

      {/* Answer: animated max-height collapse. The cap is generous because
          the new copy includes multi-paragraph answers and we don't want to
          truncate the most important content (e.g. "what's beyond sales"). */}
      <div
        id={contentId}
        role="region"
        aria-labelledby={buttonId}
        className={cn(
          'overflow-hidden transition-all duration-300 ease-out motion-reduce:transition-none',
          isOpen ? 'max-h-[900px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div className="pl-[2.65rem] pr-4 pb-4 pt-1 space-y-2.5">
          {paragraphs.map((p, i) => (
            <p key={i} className="text-[13px] text-slate-400 leading-relaxed">
              {p}
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ============================================================
 * Sidebar. About + Quick links.
 * ============================================================ */
function Sidebar() {
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-800/70 bg-slate-950/40 p-5">
        <h3 className="text-[11px] uppercase tracking-[0.14em] text-slate-300 font-semibold mb-3">
          About Leadpoet
        </h3>
        <p className="text-[12px] text-slate-400 leading-relaxed">
          Leadpoet is Subnet 71 on Bittensor, building the intelligence layer
          for modern sales. The subnet powers a continuously improving AI sales
          agent. Its purpose is to turn decentralized research and validation
          into the world&apos;s first full-funnel sales LLM.
        </p>
      </section>

      <section className="rounded-xl border border-slate-800/70 bg-slate-950/40 overflow-hidden">
        <header className="px-4 py-2 border-b border-slate-800/70 bg-gradient-to-b from-slate-900/80 to-slate-900/40">
          <span className="text-[10px] uppercase tracking-[0.14em] text-slate-300 font-semibold">
            Quick links
          </span>
        </header>
        <div className="divide-y divide-slate-800/60">
          <SidebarLink href="https://github.com/leadpoet/leadpoet">
            GitHub
          </SidebarLink>
          <SidebarLink href="https://leadpoet.com">
            leadpoet.com
          </SidebarLink>
          <SidebarLink href="mailto:hello@leadpoet.com">
            hello@leadpoet.com
          </SidebarLink>
        </div>
      </section>
    </div>
  )
}

function SidebarLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  const external = href.startsWith('http')
  return (
    <a
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      className="flex items-center gap-2 px-4 py-2.5 text-[12px] text-slate-300 hover:text-gold hover-bg-warm transition-colors group"
    >
      <span className="flex-1 truncate font-mono">{children}</span>
    </a>
  )
}

/* ============================================================
 * ContactBlock. Understated CTA with a top gold accent rule.
 * ============================================================ */
function ContactBlock() {
  return (
    <section
      aria-label="Contact"
      className="mt-10 lg:mt-12 rounded-2xl border border-slate-800/70 bg-slate-950/40 overflow-hidden"
    >
      <div className="px-6 py-6 flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-100">Still have questions?</div>
            <p className="text-[12px] text-slate-400 mt-0.5 max-w-md">
              Can&apos;t find what you&apos;re looking for? Reach out and we&apos;ll get back to you.
            </p>
          </div>
        </div>
        <a
          href="mailto:hello@leadpoet.com"
          className={cn(
            'md:ml-auto inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-[12px] font-medium',
            'text-slate-200 bg-slate-900/60 border border-slate-700/50 hover:bg-slate-800/60 hover:border-slate-600/60 transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/50'
          )}
        >
          hello@leadpoet.com
        </a>
      </div>
    </section>
  )
}
