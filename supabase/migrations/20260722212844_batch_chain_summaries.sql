-- Egress reduction: batch the three per-request chain RPCs into one call.
--
-- The fulfillment dashboard API called get_chain_winners, get_chain_root_num_leads
-- and get_chain_held_count once PER active request id (N requests -> 3xN RPCs),
-- and each function independently re-walked the same recursive fulfillment_requests
-- chain. That fan-out is the dominant weekly PostgREST volume (the ~5.46M
-- get_chain_* calls).
--
-- get_chain_summaries takes the full array of request ids, walks each chain ONCE,
-- and returns winners + root num_leads + held_count for every id in a single
-- round-trip. Logic is identical to the three existing functions (verified
-- row-for-row against live data); only the call count changes: 3xN -> 1.

CREATE OR REPLACE FUNCTION public.get_chain_summaries(p_request_ids uuid[])
RETURNS TABLE(
    request_id     uuid,
    winners        jsonb,
    root_num_leads integer,
    held_count     integer
)
LANGUAGE sql
STABLE
AS $function$
  WITH RECURSIVE input(root_id) AS (
    SELECT DISTINCT unnest(p_request_ids)
  ),
  -- Walk each root's fulfillment_requests chain once, carrying the root id so
  -- every derived value is scoped to the request that was asked about. Matches
  -- the recursion in get_chain_winners / _root_num_leads / _held_count.
  chain AS (
    SELECT i.root_id, fr.request_id, fr.num_leads
    FROM input i
    JOIN fulfillment_requests fr ON fr.request_id = i.root_id
    UNION ALL
    SELECT c.root_id, fr.request_id, fr.num_leads
    FROM fulfillment_requests fr
    JOIN chain c ON fr.successor_request_id = c.request_id
  )
  SELECT
    i.root_id AS request_id,
    -- Chain-canonical winners as [{ "lead_id": ... }], score-desc (the shape and
    -- order get_chain_winners returned; only lead_id is consumed downstream).
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('lead_id', w.lead_id)
                       ORDER BY w.consensus_final_score DESC)
      FROM public.fulfillment_score_consensus w
      JOIN chain c ON w.request_id = c.request_id
      WHERE c.root_id = i.root_id AND w.is_winner = true
    ), '[]'::jsonb) AS winners,
    (SELECT MAX(c.num_leads) FROM chain c WHERE c.root_id = i.root_id) AS root_num_leads,
    (SELECT count(*)::int
       FROM public.fulfillment_score_consensus fsc
       JOIN chain c ON fsc.request_id = c.request_id
       WHERE c.root_id = i.root_id AND fsc.is_chain_held = true) AS held_count
  FROM input i;
$function$;

-- Match the grants on the existing get_chain_* functions.
GRANT EXECUTE ON FUNCTION public.get_chain_summaries(uuid[]) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_chain_summaries(uuid[]) TO anon;
GRANT EXECUTE ON FUNCTION public.get_chain_summaries(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_chain_summaries(uuid[]) TO service_role;
