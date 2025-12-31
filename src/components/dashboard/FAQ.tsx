'use client'

import { useState, useId } from 'react'
import { ChevronDown, Rocket, MessageCircle, Github } from 'lucide-react'
import { cn } from '@/lib/utils'

// ============================================================================
// FAQ DATA - Edit this array to update FAQ content
// ============================================================================
interface FAQItem {
  id: string
  question: string
  answer: string
  category: 'technology' | 'tokenomics' | 'roadmap'
}

const faqData: FAQItem[] = [
  // Technology
  {
    id: 'tech-1',
    question: "Why Bittensor?",
    answer: "Leadpoet leverages Bittensor's open, incentive-aligned framework for decentralized data production and validation. Independent miners and validators compete on quality, enabling subnet scaling through open participation while routing value to contributors rather than a centralized operator.",
    category: 'technology'
  },
  {
    id: 'tech-2',
    question: "How does the subnet create value?",
    answer: "Miners source and curate leads while validators confirm legitimacy and assign relevance and intent scores based on request criteria. This decentralized workflow delivers quality, trust, and scale without reliance on a single provider.",
    category: 'technology'
  },
  {
    id: 'tech-3',
    question: "How are leads verified and buying intent-scored?",
    answer: "Validators perform protocol-defined quality checks to confirm company identity, contact accuracy, and data integrity. When leads are requested, miner-produced qualification models compete to curate relevant entries. Validators then score submissions based on alignment with request criteria.",
    category: 'technology'
  },
  {
    id: 'tech-4',
    question: "How does the incentive mechanism work?",
    answer: "Token emissions reward miners based on whether sourced leads pass protocol quality checks and when they are selected via subnet requests, aligning rewards with protocol inventory creation and usage.",
    category: 'technology'
  },
  // Tokenomics
  {
    id: 'token-1',
    question: "What role does Alpha play in the Leadpoet subnet?",
    answer: "Alpha is required to access commodities produced by the Leadpoet subnet. Alpha is consumed at the moment of use according to protocol rules and functions as the access mechanism for subnet resources.",
    category: 'tokenomics'
  },
  {
    id: 'token-2',
    question: "What are miner margins for contributing?",
    answer: "Miners operate lightweight, automated pipelines to collect, enrich, and submit leads, keeping operational costs low relative to protocol rewards. This efficiency supports broad participation and sustained data quality.",
    category: 'tokenomics'
  },
  // Roadmap
  {
    id: 'road-1',
    question: "What are the future growth opportunities?",
    answer: "Beyond lead generation, the subnet can expand to support additional intent-driven data commodities including readiness signals and timing indicators. The same validation framework applies to other matching problems like job candidates and M&A opportunities.",
    category: 'roadmap'
  },
  {
    id: 'road-2',
    question: "How will Leadpoet fuel the Bittensor ecosystem?",
    answer: "The subnet produces validated, intent-scored lead commodities that other subnet teams can access to support adoption of their outputs, enabling broader awareness and usage without duplicating infrastructure.",
    category: 'roadmap'
  }
]

// ============================================================================
// CONFIG
// ============================================================================
const ALLOW_MULTIPLE_OPEN = false // Set to true to allow multiple FAQs open

// ============================================================================
// COMPONENTS
// ============================================================================

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

  return (
    <div className="group">
      <button
        id={buttonId}
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
        className={cn(
          "w-full flex items-center gap-4 p-5 text-left rounded-xl transition-all duration-200",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900",
          "motion-reduce:transition-none",
          isOpen
            ? "bg-slate-800/80"
            : "hover:bg-slate-800/40"
        )}
      >
        {/* Chevron */}
        <div className={cn(
          "flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0 transition-all duration-200 motion-reduce:transition-none",
          isOpen
            ? "bg-emerald-500/20 text-emerald-400"
            : "bg-slate-700/50 text-slate-400 group-hover:bg-slate-700 group-hover:text-slate-300"
        )}>
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform duration-200 motion-reduce:transition-none",
              isOpen && "rotate-180"
            )}
          />
        </div>

        {/* Question */}
        <span className={cn(
          "flex-1 font-medium text-[15px] leading-relaxed transition-colors duration-200",
          isOpen ? "text-white" : "text-slate-200 group-hover:text-white"
        )}>
          {item.question}
        </span>
      </button>

      {/* Answer */}
      <div
        id={contentId}
        role="region"
        aria-labelledby={buttonId}
        className={cn(
          "overflow-hidden transition-all duration-300 ease-out motion-reduce:transition-none",
          isOpen ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
        )}
      >
        <div className="px-5 pb-5 pt-2 ml-12">
          <p className="text-[14px] text-slate-400 leading-relaxed">
            {item.answer}
          </p>
        </div>
      </div>
    </div>
  )
}

function Sidebar() {
  return (
    <div className="space-y-6">
      {/* Info Card */}
      <div className="rounded-2xl border border-slate-700/50 bg-gradient-to-b from-slate-800/60 to-slate-900/60 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon-64.png" alt="Leadpoet" width={40} height={40} className="object-contain" />
          </div>
          <h3 className="font-semibold text-white">About Leadpoet</h3>
        </div>
        <p className="text-sm text-slate-400 leading-relaxed">
          Leadpoet is a decentralized lead generation subnet built on Bittensor,
          where miners compete to source quality leads and validators ensure data integrity.
        </p>
      </div>

      {/* Quick Links */}
      <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-6">
        <h3 className="font-semibold text-white mb-4">Quick Links</h3>
        <div className="space-y-3">
          <a
            href="https://leadpoet.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 text-sm text-slate-400 hover:text-emerald-400 transition-colors"
          >
            <div className="w-8 h-8 rounded-lg bg-slate-700/50 flex items-center justify-center">
              <Rocket className="h-4 w-4" />
            </div>
            Visit Website
          </a>
          <a
            href="https://github.com/leadpoet"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 text-sm text-slate-400 hover:text-emerald-400 transition-colors"
          >
            <div className="w-8 h-8 rounded-lg bg-slate-700/50 flex items-center justify-center">
              <Github className="h-4 w-4" />
            </div>
            GitHub Repository
          </a>
        </div>
      </div>
    </div>
  )
}

function ContactCard() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-700/50 bg-gradient-to-br from-slate-800/80 to-slate-900/80 p-8">
      {/* Decorative gradient */}
      <div className="absolute -top-24 -right-24 w-48 h-48 rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/20 blur-3xl" />

      <div className="relative flex flex-col md:flex-row items-center gap-6">
        <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/25">
          <MessageCircle className="h-8 w-8 text-white" />
        </div>
        <div className="flex-1 text-center md:text-left">
          <h3 className="text-xl font-bold text-white mb-2">Still have questions?</h3>
          <p className="text-slate-400 text-sm">
            Can&apos;t find what you&apos;re looking for? Reach out to our team for assistance.
          </p>
        </div>
        <a
          href="mailto:hello@leadpoet.com"
          className={cn(
            "inline-flex items-center gap-2 px-6 py-3 rounded-xl font-medium text-sm",
            "bg-gradient-to-r from-emerald-500 to-teal-500 text-white",
            "hover:from-emerald-400 hover:to-teal-400 transition-all duration-200",
            "shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
          )}
        >
          hello@leadpoet.com
        </a>
      </div>
    </div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function FAQ() {
  const [openItems, setOpenItems] = useState<Set<string>>(new Set(['tech-1']))

  // Toggle accordion item
  const toggleItem = (id: string) => {
    setOpenItems(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        if (!ALLOW_MULTIPLE_OPEN) {
          next.clear()
        }
        next.add(id)
      }
      return next
    })
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="text-center mb-10">
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-3 tracking-tight">
          Frequently Asked Questions
        </h2>
        <p className="text-base text-slate-400 max-w-2xl mx-auto">
          Everything you need to know about the Leadpoet subnet
        </p>
      </div>

      {/* Main Content - Two Column Layout */}
      <div className="grid lg:grid-cols-[1fr_280px] gap-8">
        {/* FAQ List */}
        <div className="space-y-3">
          <div className="rounded-2xl border border-slate-700/50 bg-gradient-to-b from-slate-800/40 to-slate-900/40 overflow-hidden divide-y divide-slate-700/30">
            {faqData.map(item => (
              <FAQAccordionItem
                key={item.id}
                item={item}
                isOpen={openItems.has(item.id)}
                onToggle={() => toggleItem(item.id)}
              />
            ))}
          </div>
        </div>

        {/* Sidebar - Hidden on mobile */}
        <div className="hidden lg:block">
          <Sidebar />
        </div>
      </div>

      {/* Contact Card */}
      <div className="mt-12">
        <ContactCard />
      </div>
    </div>
  )
}
