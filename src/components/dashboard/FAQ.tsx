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
//  produced. Two competitions on a Bittensor subnet (model + live
//  fulfillment) replace the static-list / single-vendor status quo.
//  Alpha is the access token. Sales lead generation is the first
//  deployment of a framework that extends to any matching problem
//  with verifiable quality (talent, M&A, procurement, expansion).
//
//  Visual language matches Fulfillment / Model Competition:
//  warm off-black canvas, single gold accent, restrained palette.
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
      "Cold outbound is in a rough place. The lead lists sales teams buy from incumbents are static, sold simultaneously to thousands of competitors, scored by a single proprietary algorithm nobody can audit, and stale by the time anyone reaches out. Conversion rates have collapsed accordingly.\n\nLeadpoet rebuilds the layer underneath. Lead generation is, at its core, a continuously evolving matching problem with measurable outcomes, and the protocol is built around exactly that fact. Instead of one vendor selling the same list to everyone, sales teams get leads from a live, open market that produces fresh results tailored to each request, scored by a model that other teams are constantly trying to outdo. The output gets better whether or not you're paying attention.",
  },
  {
    id: 'why-bittensor',
    question: 'Why Bittensor?',
    answer:
      "Bittensor runs open competitions. Anyone can participate, and emissions go to whoever produces the best output. Time and time again, global competition has proven to beat any central lab, and lead quality is verifiable: did the contact exist, did the email send, did the prospect respond, did the deal close.\n\nThe competition is permanent. Someone is always trying to beat the current champion, which means the leads sales teams receive get a little better every cycle, without any central team driving it forward.",
  },
  {
    id: 'two-competitions',
    question: 'How does the subnet actually work?',
    answer:
      "Two layered competitions, working on each other.\n\nThe model competition incentivizes teams to create the best AI agent that sources high-quality, high-intent leads. Anyone can submit, validators benchmark every submission against a rotating set of 100 ICP scenarios, and the model that beats the current champion by the threshold becomes the new open baseline. Each new champion raises the minimum quality everyone in the subnet builds on.\n\nFulfillment is where the subnet produces economic outputs. When a sales team submits a request, miners running their qualified models compete in real time to source matching leads. Validators score and verify every submission, and the leads that pass quality checks and have the highest intent reach the sales team. The two competitions reinforce each other: a stronger champion gives every miner a better starting point in fulfillment, and active fulfillment demand pulls more capable models into the next round of the model competition.",
  },
  {
    id: 'model-competition',
    question: 'How does the model competition work?',
    answer:
      "The point of the model competition isn't really to crown winners. The point is to raise the minimum quality everyone else builds on. When a new champion takes over, the model becomes the open baseline: its code is public after a short delay, and the next miner who shows up can run it as-is or use it as the starting point for something better. That lowers the cost to enter, so more people enter, and the floor rises again.\n\nMechanically, anyone can submit a model. Validators benchmark it against 100 ICP scenarios, and the scenarios rotate every day. That stops models from winning by overfitting to a fixed test set and keeps the ones at the top genuinely strong across changing inputs. If a new submission beats the current champion by the published threshold on the same day's ICPs, it becomes the new open baseline. Miners then build on that baseline for the models they actually run in fulfillment, which is what compounds quality across the whole subnet over time.",
  },
  {
    id: 'fulfillment',
    question: 'How does fulfillment work?',
    answer:
      "Fulfillment is where the subnet produces economic outputs. A sales team submits a request with the criteria they care about: industry, role, geography, headcount, intent signals to prioritize. Miners running their own qualified models compete in real time to source leads that match.\n\nValidators score every submission on ICP fit, decision-maker accuracy, intent signal strength, and integrity, and verify the underlying facts (company identity, contact existence, email deliverability, employment status, intent scoring). Only leads that survive both stages reach the sales team, and the miners whose leads were chosen are compensated for them. Every request gets its own fresh competition tailored to its criteria. Incumbents work the opposite way: they give you stale data from months ago and leave filtering and qualifying to you.",
  },
  {
    id: 'incentives',
    question: 'How does the incentive mechanism work?',
    answer:
      "Two ways to earn emissions.\n\nIn fulfillment, miners earn when their leads meet every data quality and intent scoring check and score the highest in a request's competition. Validators handle the scoring; the miners whose leads win are the ones who get compensated.\n\nIn the model competition, the miner whose model produces the best output and keeps scoring at the top as the benchmark ICPs rotate daily earns. Holding up across changing inputs is what pays; overfitting to a frozen test set doesn't.\n\nTogether these incentivize what the protocol actually needs: an ever-increasing floor of model quality, and rigorous competition around every real sales request.",
  },
  {
    id: 'alpha',
    question: 'What role will Alpha play?',
    answer:
      "Alpha will gate access to the subnet's outputs. If a platform wants to tap into Leadpoet's intelligence, they'll have to leverage Alpha.\n\nThis is the cleanest design of subnet utility that can be built. More teams pulling outputs means more Alpha spent, which routes more emissions to miners, which pulls more capable models into the competition, which improves the outputs, which attracts more teams.",
  },
  {
    id: 'beyond-sales',
    question: "What's beyond sales lead generation?",
    answer:
      "Sales lead generation is the first deployment of the framework, not the ceiling. The same architecture (continuous model competition, live request fulfillment, verifiable quality) applies to any matching problem where the outcome can be measured.\n\nTalent acquisition. M&A sourcing. Customer-expansion intelligence, deciding which accounts to upsell and when. Procurement, matching suppliers to specifications. Investment research, real estate, partnership development. Each is a market with the same shape and the same brittle incumbents lead generation has.\n\nEach subsequent market plugs into the same trust infrastructure, the same validator network, and the same Alpha economy, deepening the flywheel for everything already on the subnet. Over time, other Bittensor subnets and applications will build directly on Leadpoet outputs, which puts Leadpoet in the position of being infrastructure for an entire class of intent-driven products, not just one of them.",
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
          'focus:outline-none focus-visible:bg-slate-800/50',
          'motion-reduce:transition-none',
          isOpen ? 'bg-slate-800/40' : 'hover-bg-warm'
        )}
      >
        <span
          className={cn(
            'flex items-center justify-center w-6 h-6 rounded-md flex-shrink-0 transition-colors duration-200 motion-reduce:transition-none',
            isOpen
              ? 'bg-gold-soft text-gold'
              : 'bg-slate-900/60 text-slate-500 group-hover:text-slate-300'
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
            isOpen ? 'text-slate-100 font-medium' : 'text-slate-200 group-hover:text-slate-100'
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
          Leadpoet is Subnet 71 on Bittensor. Two continuous competitions, one
          for the best lead generation model and one for live delivery, make
          the leads delivered to sales teams better every cycle.
        </p>
      </section>

      <section className="rounded-xl border border-slate-800/70 bg-slate-950/40 overflow-hidden">
        <header className="px-4 py-2 border-b border-slate-800/70 bg-gradient-to-b from-slate-900/80 to-slate-900/40">
          <span className="text-[10px] uppercase tracking-[0.14em] text-slate-300 font-semibold">
            Quick links
          </span>
        </header>
        <div className="divide-y divide-slate-800/60">
          <SidebarLink href="https://github.com/leadpoet">
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
      <span
        className="block h-px"
        style={{ background: 'linear-gradient(90deg, transparent, #c9a96e 50%, transparent)' }}
        aria-hidden
      />
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
            'text-gold bg-gold-soft border border-gold-strong hover:bg-gold-tint transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-soft'
          )}
        >
          hello@leadpoet.com
        </a>
      </div>
    </section>
  )
}
