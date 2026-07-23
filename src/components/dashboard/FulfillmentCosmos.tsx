'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'

// Aggregated per-(request, miner) consensus link — the shape the layout math
// always reduced raw lead rows to; now delivered pre-aggregated by the API so
// the every-60s payload no longer carries raw rows.
export interface CosmosMinerLink {
  request_id: string
  miner_hotkey: string
  lead_count: number
  win_count: number
}

export interface CosmosRequest {
  request_id: string
  status: string
  num_leads: number
  created_at: string
  icp_details?: {
    industry?: string
    sub_industry?: string
    target_roles?: string[]
  }
}

interface GraphNode {
  id: string
  type: 'request' | 'miner'
  x: number
  y: number
  vx: number
  vy: number
  label: string
  request?: CosmosRequest
  hotkey?: string
  leadCount: number
  winCount: number
  requestCount: number
  industry?: string
  isPending?: boolean
  /** Anchor (industry centroid) to keep cluster cohesion during relaxation. */
  ax?: number
  ay?: number
  fixed?: boolean
}

interface GraphEdge {
  sourceId: string
  targetId: string
  count: number
  winCount: number
}

interface IndustryCluster {
  key: string
  label: string
  cx: number
  cy: number
  radius: number
  requestIds: string[]
}

interface LayoutResult {
  nodes: GraphNode[]
  edges: GraphEdge[]
  nodeById: Map<string, GraphNode>
  clusters: IndustryCluster[]
}

const REQUEST_RADIUS = 9
const MINER_RADIUS = 3.2
const PENDING_COMPLETED_BUFFER = 72
const INDUSTRY_CLUSTER_SPACING = 132
const MAX_INDUSTRY_CLUSTER_RADIUS = 430

// Platinum-monochrome palette. Hierarchy by brightness, never hue:
// fulfilled (the win) is the rationed near-white accent; everything
// else is a warm-neutral grey. No gold, amber, or saturated chroma.
const COLOR_WIN_EDGE = '#e8f0ff'                      // near-white, fulfilled leads (the win)
const COLOR_LOSS_EDGE = 'rgba(236, 234, 230, 0.16)'  // faint platinum-grey, submitted-only
const COLOR_REQUEST_PENDING = '#6c6b66'              // muted neutral, waiting
const COLOR_REQUEST_COMPLETED = '#ededec'            // platinum, finalized
const COLOR_MINER = '#56544e'                        // neutral grey miner
const COLOR_MINER_WINNING = '#b8b6b0'               // light platinum, miner with wins

const PENDING_STATUSES = new Set(['pending', 'open', 'continued_open', 'commit_closed', 'scoring'])

/**
 * Smart truncation for industry-like labels. Handles strings, arrays, and
 * arbitrary length. Keeps the first `maxItems` items, then appends "+N more",
 * and finally caps the whole result at `maxChars` with a trailing ellipsis.
 */
function industryLabel(v: unknown, maxItems = 2, maxChars = 30): string {
  let raw: string
  if (typeof v === 'string') {
    raw = v
  } else if (Array.isArray(v)) {
    const items = v.filter((x): x is string => typeof x === 'string' && x.length > 0)
    if (items.length === 0) return ''
    const shown = items.slice(0, maxItems).join(', ')
    raw = items.length > maxItems ? `${shown} +${items.length - maxItems}` : shown
  } else if (v == null) {
    return ''
  } else {
    raw = String(v)
  }
  if (raw.length > maxChars) return raw.slice(0, maxChars - 1).trimEnd() + '…'
  return raw
}

function primaryIndustry(req: CosmosRequest): string {
  const ind = req.icp_details?.industry
  if (typeof ind === 'string' && ind.length > 0) return ind
  if (Array.isArray(ind)) {
    for (const v of ind) if (typeof v === 'string' && v.length > 0) return v
  }
  return 'Other'
}

function simpleHash(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

function truncateHotkey(h: string): string {
  if (h.length <= 12) return h
  return `${h.slice(0, 6)}...${h.slice(-4)}`
}

function renderedNodeRadius(n: GraphNode): number {
  return n.type === 'request'
    ? REQUEST_RADIUS + Math.min(8, Math.log2(1 + (n.leadCount || 1)) * 2)
    : MINER_RADIUS + Math.min(3, (n.winCount || 0) * 0.5)
}

function computeLayout(requests: CosmosRequest[], leads: CosmosMinerLink[]): LayoutResult {
  const nodeById = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []
  const clusters: IndustryCluster[] = []
  const requestIdsWithVisibleLeads = new Set(leads.map((l) => l.request_id))

  // === 1. Split requests into pending + completed (or other) ===
  const pendingRequests: CosmosRequest[] = []
  const completedRequests: CosmosRequest[] = []
  for (const r of requests) {
    if (PENDING_STATUSES.has(r.status)) pendingRequests.push(r)
    // A completed request with no consensus rows has no relationship to draw.
    // Keeping it as a white node makes it look fulfilled in this graph even
    // though the visualization has no evidence to connect it to miners/leads.
    else if (requestIdsWithVisibleLeads.has(r.request_id)) completedRequests.push(r)
  }

  // === 2. Build industry clusters for completed requests ===
  const industryGroups = new Map<string, CosmosRequest[]>()
  for (const r of completedRequests) {
    const key = primaryIndustry(r)
    const arr = industryGroups.get(key) || []
    arr.push(r)
    industryGroups.set(key, arr)
  }

  const sortedIndustries = Array.from(industryGroups.entries()).sort(
    (a, b) => b[1].length - a[1].length
  )

  // Place each industry cluster on a compact sunflower spiral. The largest
  // group owns the center; smaller singleton industries stay capped near the
  // constellation so hidden cluster anchors don't read as escaped nodes.
  const golden = Math.PI * (3 - Math.sqrt(5))

  sortedIndustries.forEach(([key, group], i) => {
    const r = i === 0
      ? 0
      : Math.min(MAX_INDUSTRY_CLUSTER_RADIUS, INDUSTRY_CLUSTER_SPACING * Math.sqrt(i))
    const a = i * golden
    const cx = r * Math.cos(a)
    const cy = r * Math.sin(a)
    const clusterRadius = 40 + Math.sqrt(group.length) * 22

    clusters.push({
      key,
      label: key,
      cx,
      cy,
      radius: clusterRadius,
      requestIds: group.map((g) => g.request_id),
    })

    // Place each request in the cluster as a sunflower
    group.forEach((req, j) => {
      const r2 = clusterRadius * 0.55 * Math.sqrt((j + 1) / Math.max(1, group.length))
      const a2 = j * golden
      const px = cx + r2 * Math.cos(a2)
      const py = cy + r2 * Math.sin(a2)
      nodeById.set(`req:${req.request_id}`, {
        id: `req:${req.request_id}`,
        type: 'request',
        x: px,
        y: py,
        vx: 0,
        vy: 0,
        label: req.request_id,
        request: req,
        leadCount: 0,
        winCount: 0,
        requestCount: 1,
        industry: key,
        ax: cx,
        ay: cy,
      })
    })
  })

  // === 3. Pending requests are placed AFTER force relaxation (step 8) so
  // their orbit reflects the cluster's actual post-relaxation footprint.
  // Placing them here, before relaxation expands the cluster, would push
  // them way out into empty space. ===

  // === 4. Aggregate edges: one per (miner, request) pair with count + winCount ===
  const relevantRequestIds = new Set(requests.map((r) => r.request_id))
  const pairAgg = new Map<string, { count: number; winCount: number }>()
  const minerInfo = new Map<
    string,
    { totalLeads: number; totalWins: number; requestIds: Set<string> }
  >()

  // Links arrive pre-aggregated per (request, miner) — sum them into the same
  // pair/miner structures the raw-row loop used to build.
  for (const link of leads) {
    if (!relevantRequestIds.has(link.request_id)) continue
    const key = `${link.request_id}|${link.miner_hotkey}`
    const cur = pairAgg.get(key) || { count: 0, winCount: 0 }
    cur.count += link.lead_count
    cur.winCount += link.win_count
    pairAgg.set(key, cur)

    const info =
      minerInfo.get(link.miner_hotkey) || {
        totalLeads: 0,
        totalWins: 0,
        requestIds: new Set<string>(),
      }
    info.totalLeads += link.lead_count
    info.totalWins += link.win_count
    info.requestIds.add(link.request_id)
    minerInfo.set(link.miner_hotkey, info)
  }

  // === 5. Place miners using gravity toward their request centroids ===
  for (const [hotkey, info] of minerInfo.entries()) {
    let cx = 0
    let cy = 0
    let count = 0
    for (const reqId of info.requestIds) {
      const n = nodeById.get(`req:${reqId}`)
      if (n && !n.isPending) {
        cx += n.x
        cy += n.y
        count++
      }
    }
    if (count === 0) continue
    cx /= count
    cy /= count

    const h = simpleHash(hotkey)
    const angle = ((h % 1000) / 1000) * Math.PI * 2
    const dist = 38 + ((h >> 4) % 32)

    nodeById.set(`mnr:${hotkey}`, {
      id: `mnr:${hotkey}`,
      type: 'miner',
      x: cx + dist * Math.cos(angle),
      y: cy + dist * Math.sin(angle),
      vx: 0,
      vy: 0,
      label: hotkey,
      hotkey,
      leadCount: info.totalLeads,
      winCount: info.totalWins,
      requestCount: info.requestIds.size,
    })
  }

  // === 6. Build edge list (already consolidated) ===
  for (const [key, agg] of pairAgg.entries()) {
    const [requestId, minerHotkey] = key.split('|')
    const sourceId = `req:${requestId}`
    const targetId = `mnr:${minerHotkey}`
    if (!nodeById.has(sourceId) || !nodeById.has(targetId)) continue
    edges.push({
      sourceId,
      targetId,
      count: agg.count,
      winCount: agg.winCount,
    })

    const reqNode = nodeById.get(sourceId)
    if (reqNode) {
      reqNode.leadCount += agg.count
      reqNode.winCount += agg.winCount
    }
  }

  // === 7. Force relaxation (only over completed nodes; pending are fixed) ===
  const movableNodes = Array.from(nodeById.values()).filter((n) => !n.fixed)
  const N = movableNodes.length

  if (N > 1) {
    const seenPairs = new Set<string>()
    const uniqueEdges: { a: GraphNode; b: GraphNode; restLen: number }[] = []
    for (const e of edges) {
      const k = e.sourceId < e.targetId ? `${e.sourceId}|${e.targetId}` : `${e.targetId}|${e.sourceId}`
      if (seenPairs.has(k)) continue
      seenPairs.add(k)
      const a = nodeById.get(e.sourceId)!
      const b = nodeById.get(e.targetId)!
      if (a.fixed || b.fixed) continue
      uniqueEdges.push({ a, b, restLen: 60 })
    }

    const ITER = N > 800 ? 40 : N > 400 ? 70 : 110
    const REPEL = 1800
    const ATTRACT = 0.05
    const DAMPING = 0.65
    const ANCHOR_PULL = 0.012

    for (let iter = 0; iter < ITER; iter++) {
      const alpha = Math.max(0.15, 1 - iter / ITER)

      // Pairwise repulsion (movable nodes only)
      for (let i = 0; i < N; i++) {
        const a = movableNodes[i]
        for (let j = i + 1; j < N; j++) {
          const b = movableNodes[j]
          const dx = b.x - a.x
          const dy = b.y - a.y
          let dist2 = dx * dx + dy * dy
          if (dist2 < 4) dist2 = 4
          const dist = Math.sqrt(dist2)
          const sizeBoost = (a.type === 'request' ? 2.4 : 1) * (b.type === 'request' ? 2.4 : 1)
          const force = (REPEL * sizeBoost) / dist2
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force
          a.vx -= fx
          a.vy -= fy
          b.vx += fx
          b.vy += fy
        }
      }

      // Edge attraction
      for (const e of uniqueEdges) {
        const dx = e.b.x - e.a.x
        const dy = e.b.y - e.a.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const force = ATTRACT * (dist - e.restLen)
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        e.a.vx += fx
        e.a.vy += fy
        e.b.vx -= fx
        e.b.vy -= fy
      }

      // Anchor pull toward industry centroid (only for request nodes with anchor)
      for (const n of movableNodes) {
        if (n.ax !== undefined && n.ay !== undefined) {
          n.vx += (n.ax - n.x) * ANCHOR_PULL
          n.vy += (n.ay - n.y) * ANCHOR_PULL
        }
        n.x += n.vx * alpha
        n.y += n.vy * alpha
        n.vx *= DAMPING
        n.vy *= DAMPING
      }
    }
  }

  // === 8. Place pending requests outside the completed graph boundary ===
  // Done after force relaxation so the orbit radius reflects the cluster's
  // visible footprint, not the pre-sim compact placement.
  if (pendingRequests.length > 0) {
    // Use every completed point, including miner hotkeys. This keeps pending
    // requests outside the circle a viewer would draw around the completed
    // request/miner constellation instead of only outside request nodes.
    const completedBoundaryNodes = Array.from(nodeById.values()).filter(
      (n) => !(n.type === 'request' && n.isPending)
    )
    const orbitAnchorNodes = completedBoundaryNodes.length > 0 ? completedBoundaryNodes : []

    // Use the bounding-box center of the completed constellation, not the
    // statistical centroid. The viewport auto-fit centers on the bbox of
    // all rendered nodes, so anchoring the pending orbit on the same bbox
    // center ensures top/bottom/left/right pending sit symmetrically
    // around the visible center after auto-fit. The centroid can drift
    // toward dense regions (e.g. a long miner tail) and make symmetric
    // angular placement look skewed once the viewport recenters.
    let bboxMinX = Infinity
    let bboxMaxX = -Infinity
    let bboxMinY = Infinity
    let bboxMaxY = -Infinity
    for (const n of orbitAnchorNodes) {
      const r = renderedNodeRadius(n)
      if (n.x - r < bboxMinX) bboxMinX = n.x - r
      if (n.x + r > bboxMaxX) bboxMaxX = n.x + r
      if (n.y - r < bboxMinY) bboxMinY = n.y - r
      if (n.y + r > bboxMaxY) bboxMaxY = n.y + r
    }
    const haveBbox =
      Number.isFinite(bboxMinX) &&
      Number.isFinite(bboxMaxX) &&
      Number.isFinite(bboxMinY) &&
      Number.isFinite(bboxMaxY)
    const cx = haveBbox ? (bboxMinX + bboxMaxX) / 2 : 0
    const cy = haveBbox ? (bboxMinY + bboxMaxY) / 2 : 0

    // Actual completed boundary measured from the bbox center. Include each
    // node's rendered radius so the pending ring clears the outer edge of
    // every completed request/miner.
    let clusterEdge = 160
    for (const n of orbitAnchorNodes) {
      clusterEdge = Math.max(clusterEdge, Math.hypot(n.x - cx, n.y - cy) + renderedNodeRadius(n))
    }
    if (!Number.isFinite(clusterEdge) || clusterEdge < 1) clusterEdge = 160

    // Pending request nodes render at roughly REQUEST_RADIUS. Keep every
    // pending node on the exact same radius so the outer ring reads as a
    // clean, intentional orbit rather than an organic scatter.
    const orbitRadius = clusterEdge + REQUEST_RADIUS + PENDING_COMPLETED_BUFFER

    pendingRequests.forEach((req, i) => {
      // Evenly spaced base angles around the full circle. We start at -π/2 (top)
      // and step by 2π / N so the ring reads as intentional.
      const angle = -Math.PI / 2 + (i / pendingRequests.length) * Math.PI * 2
      nodeById.set(`req:${req.request_id}`, {
        id: `req:${req.request_id}`,
        type: 'request',
        x: cx + orbitRadius * Math.cos(angle),
        y: cy + orbitRadius * Math.sin(angle),
        vx: 0,
        vy: 0,
        label: req.request_id,
        request: req,
        leadCount: 0,
        winCount: 0,
        requestCount: 1,
        industry: primaryIndustry(req),
        isPending: true,
        fixed: true,
      })
    })
  }

  return {
    nodes: Array.from(nodeById.values()),
    edges,
    nodeById,
    clusters,
  }
}

interface CosmosProps {
  requests: CosmosRequest[]
  leads: CosmosMinerLink[]
  visibleNodeIds?: Set<string> | null
  forceLabelIds?: Set<string> | null
  emphasizedNodeIds?: Set<string> | null
  onRequestActivate?: (request: CosmosRequest) => void
  onMinerActivate?: (hotkey: string) => void
}

export function FulfillmentCosmos({
  requests,
  leads,
  visibleNodeIds = null,
  forceLabelIds = null,
  emphasizedNodeIds = null,
  onRequestActivate,
  onMinerActivate,
}: CosmosProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Transient focus pin: holds the just-clicked node's id for a short
  // window so the cosmos doesn't visually "flash" during the click -> dialog
  // open transition (mouseleave clears hoveredId; without a pin, focusId
  // would briefly become null and every edge would snap to the default
  // bright state). Auto-clears on a timer so closing the dialog doesn't
  // leave a stale highlight on the node the user opened.
  const [pinnedFocusId, setPinnedFocusId] = useState<string | null>(null)
  const pinnedFocusTimerRef = useRef<number | null>(null)
  const [computing, setComputing] = useState(true)
  const [layout, setLayout] = useState<LayoutResult | null>(null)
  const [filterKey, setFilterKey] = useState(0)
  // viewFitted gates the visibility of the SVG group. Without this guard,
  // there is a single render between `setLayout` and the auto-fit effect
  // where the nodes briefly paint at the default (0,0) scale=1 transform
  // (so the cosmos "snaps" in the upper-left corner before centering).
  // Holding the group hidden until auto-fit has run gives a clean cross-
  // fade from the loading overlay straight into the final position.
  const [viewFitted, setViewFitted] = useState(false)
  // Track the structural signature of the last computed layout. Auto-refresh
  // polling produces new array refs even when the underlying nodes/edges
  // haven't changed; without this guard the cosmos would re-key its <g>
  // root and replay the fade-in animation every poll cycle, causing a
  // visible flash during user interactions like opening a dialog.
  const lastSigRef = useRef<string>('')
  const hasLayoutRef = useRef(false)

  useEffect(() => {
    const update = () => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      setSize({ w: rect.width, h: rect.height })
    }
    update()
    const obs = new ResizeObserver(update)
    if (containerRef.current) obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    // Build a stable structural signature so identity-only changes
    // (same data, new array refs from polling) don't trigger a recompute.
    const reqSig = requests
      .map((r) => `${r.request_id}:${r.status}`)
      .sort()
      .join('|')
    const leadSig = leads
      .map(
        (l) =>
          `${l.request_id}:${l.miner_hotkey}:${l.lead_count}:${l.win_count}`
      )
      .sort()
      .join('|')
    const sig = `${reqSig}#${leadSig}`
    if (sig === lastSigRef.current) return
    lastSigRef.current = sig

    // Only show the "Mapping cosmos" overlay on the very first compute.
    // Subsequent recomputes (filter changes, real data changes) keep the
    // current layout visible while we calculate the new one in the
    // background, then swap with a fade-in.
    if (!hasLayoutRef.current) setComputing(true)
    // The new layout will need re-fitting before it is safe to show, so we
    // hide the SVG group again until the auto-fit effect runs.
    setViewFitted(false)
    setFilterKey((k) => k + 1)
    let cancelled = false
    const id = window.setTimeout(() => {
      if (cancelled) return
      const result = computeLayout(requests, leads)
      hasLayoutRef.current = true
      setLayout(result)
    }, 10)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [requests, leads])

  useEffect(() => {
    if (!layout) return
    if (layout.nodes.length === 0) {
      setViewFitted(true)
      setComputing(false)
      return
    }
    if (size.w <= 0 || size.h <= 0) return
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity
    for (const n of layout.nodes) {
      if (n.x < minX) minX = n.x
      if (n.x > maxX) maxX = n.x
      if (n.y < minY) minY = n.y
      if (n.y > maxY) maxY = n.y
    }
    // 18% padding around the graph for premium breathing room
    const padX = (maxX - minX) * 0.18 + 100
    const padY = (maxY - minY) * 0.18 + 100
    const gw = Math.max(1, maxX - minX + padX * 2)
    const gh = Math.max(1, maxY - minY + padY * 2)
    const scale = Math.min(size.w / gw, size.h / gh, 1.15)
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    setView({
      scale,
      tx: size.w / 2 - cx * scale,
      ty: size.h / 2 - cy * scale,
    })
    // The view is now anchored on the new layout. Reveal the SVG group and
    // dismiss the loading overlay together so the cosmos cross-fades from
    // the loader to its final position with no intermediate flash.
    setViewFitted(true)
    setComputing(false)
  }, [layout, size.w, size.h])

  // Attach wheel via DOM addEventListener so we can opt out of passive (default in React 18+)
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = svg.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      setView((prev) => {
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
        const newScale = Math.max(0.15, Math.min(6, prev.scale * factor))
        const k = newScale / prev.scale
        return {
          scale: newScale,
          tx: mx - (mx - prev.tx) * k,
          ty: my - (my - prev.ty) * k,
        }
      })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      const target = e.target as Element
      if (target.closest('[data-node-id]')) return
      setIsDragging(true)
      setSelectedId(null)
      dragStart.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }
    },
    [view.tx, view.ty]
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return
      const start = dragStart.current
      if (!start) return
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      setView((prev) => ({ ...prev, tx: start.tx + dx, ty: start.ty + dy }))
    },
    [isDragging]
  )

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
    dragStart.current = null
  }, [])

  const focusId = hoveredId || pinnedFocusId || selectedId

  useEffect(() => {
    return () => {
      if (pinnedFocusTimerRef.current) {
        window.clearTimeout(pinnedFocusTimerRef.current)
      }
    }
  }, [])

  const highlightedEdgeIdx = useMemo(() => {
    if (!layout || !focusId) return null
    const set = new Set<number>()
    layout.edges.forEach((e, idx) => {
      if (e.sourceId === focusId || e.targetId === focusId) set.add(idx)
    })
    return set
  }, [layout, focusId])

  const connectedNodes = useMemo(() => {
    if (!layout || !focusId) return null
    const set = new Set<string>([focusId])
    for (const e of layout.edges) {
      if (e.sourceId === focusId) set.add(e.targetId)
      if (e.targetId === focusId) set.add(e.sourceId)
    }
    return set
  }, [layout, focusId])

  const stats = useMemo(() => {
    if (!layout) return null
    let requestNodes = 0
    let minerNodes = 0
    for (const n of layout.nodes) {
      if (visibleNodeIds && !visibleNodeIds.has(n.id)) continue
      if (n.type === 'request') requestNodes++
      else minerNodes++
    }
    let totalEdges = 0
    let fulfilledEdges = 0
    for (const e of layout.edges) {
      if (visibleNodeIds && (!visibleNodeIds.has(e.sourceId) || !visibleNodeIds.has(e.targetId))) continue
      totalEdges += e.count
      fulfilledEdges += e.winCount
    }
    return { requestNodes, minerNodes, totalLeads: totalEdges, fulfilledLeads: fulfilledEdges }
  }, [layout, visibleNodeIds])

  const isNodeVisible = useCallback(
    (id: string) => (visibleNodeIds ? visibleNodeIds.has(id) : true),
    [visibleNodeIds]
  )

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden rounded-xl border border-[var(--surface-border)] bg-[var(--surface-base)]"
    >
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        className={isDragging ? 'cursor-grabbing' : 'cursor-grab'}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <defs>
          {/* Each gradient is a soft inner highlight → flat base. Highlights are
              a sliver brighter than the base so nodes feel slightly dimensional
              without looking glossy or "designed". */}
          <radialGradient id="cosmos-grad-completed" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="100%" stopColor={COLOR_REQUEST_COMPLETED} stopOpacity="1" />
          </radialGradient>
          <radialGradient id="cosmos-grad-pending" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#9a9690" stopOpacity="1" />
            <stop offset="100%" stopColor={COLOR_REQUEST_PENDING} stopOpacity="1" />
          </radialGradient>
          <radialGradient id="cosmos-grad-miner-win" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#d6d4cd" stopOpacity="1" />
            <stop offset="100%" stopColor={COLOR_MINER_WINNING} stopOpacity="1" />
          </radialGradient>
          <radialGradient id="cosmos-grad-miner" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#7a766e" stopOpacity="1" />
            <stop offset="100%" stopColor={COLOR_MINER} stopOpacity="1" />
          </radialGradient>
        </defs>

        <g
          key={filterKey}
          transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}
          style={{
            // Cross-fade in once the auto-fit has anchored the view, so the
            // graph never paints at the default (0,0) corner first.
            opacity: viewFitted ? 1 : 0,
            transition: 'opacity 280ms ease-out',
            pointerEvents: viewFitted ? 'auto' : 'none',
          }}
        >
          {/* Industry clustering is preserved in the layout math (anchor pull
              keeps same-industry requests near each other) but we don't render
              labels or boundaries, which keeps the cosmos uncluttered. */}

          {/* Edges */}
          {layout &&
            layout.edges.map((edge, i) => {
              const s = layout.nodeById.get(edge.sourceId)
              const t = layout.nodeById.get(edge.targetId)
              if (!s || !t) return null
              if (!isNodeVisible(s.id) || !isNodeVisible(t.id)) return null
              const isFocused = highlightedEdgeIdx?.has(i) ?? false
              const dim = focusId !== null && !isFocused
              const hasWin = edge.winCount > 0
              const stroke = hasWin ? COLOR_WIN_EDGE : COLOR_LOSS_EDGE
              // Logarithmic thickness based on lead count
              const baseWidth = 0.5 + Math.log2(edge.count + 1) * 0.75
              const width = isFocused ? baseWidth * 1.6 : baseWidth
              const opacity = hasWin
                ? isFocused
                  ? 0.95
                  : dim
                    ? 0.12
                    : 0.7
                : isFocused
                  ? 0.7
                  : dim
                    ? 0.05
                    : 1

              const dx = t.x - s.x
              const dy = t.y - s.y
              const dist = Math.sqrt(dx * dx + dy * dy) || 1
              // Subtle curve for visual rhythm
              const curveAmount = Math.min(dist * 0.12, 18)
              const mx = (s.x + t.x) / 2
              const my = (s.y + t.y) / 2
              const nx = -dy / dist
              const ny = dx / dist
              // Curve direction influenced by edge index (alternating) for separation
              const dir = (i % 2 === 0 ? 1 : -1) * (edge.count > 1 ? 1 : 0.4)
              const cx = mx + nx * curveAmount * dir
              const cy = my + ny * curveAmount * dir

              return (
                <path
                  key={i}
                  d={`M ${s.x} ${s.y} Q ${cx} ${cy} ${t.x} ${t.y}`}
                  fill="none"
                  stroke={stroke}
                  strokeOpacity={opacity}
                  strokeWidth={width}
                  strokeLinecap="round"
                />
              )
            })}

          {/* Nodes */}
          {layout &&
            layout.nodes.map((node) => {
              if (!isNodeVisible(node.id)) return null
              const isFocused = focusId === node.id
              const isEmphasized = emphasizedNodeIds?.has(node.id) ?? false
              const isConnected = connectedNodes?.has(node.id) ?? false
              const dim = focusId !== null && !isConnected
              const isRequest = node.type === 'request'
              const status = node.request?.status || ''
              const baseR = renderedNodeRadius(node)
              const isPending = isRequest && PENDING_STATUSES.has(status)

              let fillRef: string
              if (isRequest) {
                fillRef = isPending ? 'url(#cosmos-grad-pending)' : 'url(#cosmos-grad-completed)'
              } else if (node.winCount && node.winCount > 0) {
                fillRef = 'url(#cosmos-grad-miner-win)'
              } else {
                fillRef = 'url(#cosmos-grad-miner)'
              }

              const opacity = dim ? 0.18 : 1
              const shouldShowLabel =
                isRequest && (isFocused || (forceLabelIds?.has(node.id) ?? false))

              const pinFocus = () => {
                setPinnedFocusId(node.id)
                if (pinnedFocusTimerRef.current) {
                  window.clearTimeout(pinnedFocusTimerRef.current)
                }
                pinnedFocusTimerRef.current = window.setTimeout(() => {
                  setPinnedFocusId(null)
                  pinnedFocusTimerRef.current = null
                }, 350)
              }

              const activate = () => {
                if (isRequest && node.request && onRequestActivate) {
                  // Briefly pin focus so the cosmos doesn't snap back to its
                  // default state while the dialog is opening; auto-clears
                  // shortly after so closing the dialog leaves no stale
                  // highlight.
                  pinFocus()
                  onRequestActivate(node.request)
                  return
                }
                if (!isRequest && node.hotkey && onMinerActivate) {
                  pinFocus()
                  onMinerActivate(node.hotkey)
                  return
                }
                // No callback: behave like a toggle selection.
                setSelectedId(selectedId === node.id ? null : node.id)
              }
              const accessibleLabel = isRequest
                ? `Request ${node.label.slice(0, 8)}, ${node.leadCount} leads, ${node.winCount} won`
                : `Miner ${truncateHotkey(node.hotkey || '')}, ${node.leadCount} leads, ${node.winCount} won`

              return (
                <g
                  key={node.id}
                  data-node-id={node.id}
                  className={isPending ? 'pending-breath' : undefined}
                  style={{
                    cursor: 'pointer',
                    opacity,
                    outline: 'none',
                    transition: 'opacity 200ms ease-out',
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={accessibleLabel}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onFocus={() => setHoveredId(node.id)}
                  onBlur={() => setHoveredId(null)}
                  onClick={(e) => {
                    e.stopPropagation()
                    // Blur the trigger so Radix's dialog focus-restore on close
                    // doesn't return focus here and re-trigger onFocus, which
                    // would leave the node highlighted until the user clicks
                    // empty space.
                    ;(e.currentTarget as unknown as { blur?: () => void }).blur?.()
                    activate()
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      e.stopPropagation()
                      ;(e.currentTarget as unknown as { blur?: () => void }).blur?.()
                      activate()
                    }
                  }}
                >
                  {isEmphasized && !isFocused && (
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={baseR + 5}
                      fill="none"
                      stroke="#ffffff"
                      strokeOpacity={0.75}
                      strokeWidth={1.2}
                    />
                  )}
                  {isFocused && (
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={baseR + 5}
                      fill="none"
                      stroke={isRequest ? (isPending ? COLOR_REQUEST_PENDING : COLOR_REQUEST_COMPLETED) : COLOR_MINER_WINNING}
                      strokeOpacity={0.55}
                      strokeWidth={1}
                    />
                  )}
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={baseR}
                    fill={fillRef}
                    stroke={
                      isFocused || isEmphasized
                        ? '#ffffff'
                        : isRequest
                          ? 'rgba(255,255,255,0.22)'
                          : 'rgba(255,255,255,0.10)'
                    }
                    strokeWidth={isFocused || isEmphasized ? 1.4 : 0.6}
                    style={{ transition: 'stroke 160ms ease-out, stroke-width 160ms ease-out' }}
                  />
                  {shouldShowLabel && (
                    <text
                      x={node.x}
                      y={node.y - baseR - 8}
                      textAnchor="middle"
                      style={{
                        fontSize: 11 / view.scale,
                        fontFamily: 'var(--font-sans), sans-serif',
                        fontWeight: 500,
                        fill: '#f5f0e8',
                        stroke: 'rgba(8, 8, 10, 0.94)',
                        strokeWidth: 3.5 / view.scale,
                        strokeLinejoin: 'round',
                        paintOrder: 'stroke fill',
                        pointerEvents: 'none',
                      }}
                    >
                      {industryLabel(node.request?.icp_details?.industry, 2, 30) ||
                        node.label.slice(0, 8)}
                    </text>
                  )}
                  {!isRequest && (isFocused || isEmphasized) && (
                    <text
                      x={node.x}
                      y={node.y + baseR + 9}
                      textAnchor="middle"
                      style={{
                        fontSize: 10 / view.scale,
                        fontFamily: 'var(--font-mono), monospace',
                        fill: '#e8e1d4',
                        stroke: 'rgba(8, 8, 10, 0.94)',
                        strokeWidth: 3 / view.scale,
                        strokeLinejoin: 'round',
                        paintOrder: 'stroke fill',
                        pointerEvents: 'none',
                      }}
                    >
                      {truncateHotkey(node.hotkey || '')}
                    </text>
                  )}
                </g>
              )
            })}
        </g>
      </svg>

      {/* Loading skeleton: orbital dots */}
      {computing && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none">
          <div className="relative w-32 h-32">
            {Array.from({ length: 12 }).map((_, i) => {
              const angle = (i / 12) * Math.PI * 2
              const r = 56
              const x = 64 + r * Math.cos(angle)
              const y = 64 + r * Math.sin(angle)
              return (
                <div
                  key={i}
                  className="absolute w-1.5 h-1.5 rounded-full orbit-dot"
                  style={{
                    left: `${x - 3}px`,
                    top: `${y - 3}px`,
                    animationDelay: `${i * 100}ms`,
                    background: 'rgba(232, 240, 255, 0.7)',
                  }}
                />
              )
            })}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--text-tertiary)] font-medium">
                Mapping cosmos
              </div>
            </div>
          </div>
        </div>
      )}

      {!computing && layout && layout.nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="rounded-lg border border-[var(--surface-border)] bg-[rgba(16,16,19,0.72)] px-4 py-3 text-center">
            <div className="text-xs font-medium text-[color:var(--text-secondary)]">
              No visible lead relationships for this view.
            </div>
            <div className="mt-1 text-[10px] text-[color:var(--text-tertiary)]">
              Completed requests are shown once consensus rows are available.
            </div>
          </div>
        </div>
      )}

      {/* Legend chip: warm neutral surface, gold accent for "fulfilled" */}
      {!computing && stats && (
        <div className="absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] flex w-fit flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] bg-[rgba(16,16,19,0.78)] backdrop-blur-md rounded-md px-3 py-1.5 border border-[var(--surface-border)] pointer-events-none font-mono text-[color:var(--text-secondary)]">
          {/* Request status */}
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: COLOR_REQUEST_PENDING }}
            />
            <span>Pending request</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: COLOR_REQUEST_COMPLETED }}
            />
            <span>Completed request</span>
          </span>

          <span className="opacity-30">·</span>

          {/* Lead types */}
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-0.5 rounded-full"
              style={{ background: 'rgba(245, 240, 232, 0.3)' }}
            />
            <span>Submitted lead</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 rounded-full" style={{ background: COLOR_WIN_EDGE }} />
            <span>Fulfilled lead</span>
          </span>

        </div>
      )}

    </div>
  )
}
