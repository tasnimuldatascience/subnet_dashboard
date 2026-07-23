-- Egress reduction: aggregate the fulfillment cosmos/graph inputs in SQL.
--
-- The every-60s refresh still transferred every raw consensus row (~10.4k rows,
-- ~3.6 MB/min after column trimming) although every consumer -- the cosmos
-- constellation, the request cards, the miner directory, and the stat strips --
-- aggregates per (request, miner). This returns those aggregates directly
-- (one row per request+miner pair); raw lead rows are fetched only when a
-- request dialog opens (GET /api/fulfillment?requestId=...).
--
-- Winner semantics match the raw path exactly: when ANY chain-canonical winner
-- exists for the request set, a lead counts as a winner iff it wins anywhere in
-- its request's recursive fulfillment chain; otherwise the row's own is_winner
-- is used (same rule as the former client-side override and the histogram RPC).

CREATE OR REPLACE FUNCTION public.get_fulfillment_graph_summary(p_request_ids uuid[])
RETURNS TABLE(
    request_id       uuid,
    miner_hotkey     text,
    lead_count       bigint,
    win_count        bigint,
    last_computed_at timestamptz
)
LANGUAGE plpgsql
STABLE
AS $function$
BEGIN
    IF p_request_ids IS NULL THEN
        RETURN;
    END IF;
    -- Bound the RAW array BEFORE any unnest (duplicate-flood safe).
    IF cardinality(p_request_ids) > 100 THEN
        RAISE EXCEPTION 'get_fulfillment_graph_summary accepts at most 100 request ids'
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    WITH RECURSIVE input(root_id) AS (
        SELECT DISTINCT unnest(p_request_ids)
    ),
    chain AS (
        SELECT i.root_id, fr.request_id
        FROM input i JOIN public.fulfillment_requests fr ON fr.request_id = i.root_id
        UNION
        SELECT c.root_id, fr.request_id
        FROM public.fulfillment_requests fr JOIN chain c ON fr.successor_request_id = c.request_id
    ),
    chain_winners AS (
        SELECT DISTINCT i.root_id AS rid, w.lead_id
        FROM input i
        JOIN chain c ON c.root_id = i.root_id
        JOIN public.fulfillment_score_consensus w ON w.request_id = c.request_id
        WHERE w.is_winner = true
    ),
    any_winner AS (SELECT EXISTS (SELECT 1 FROM chain_winners) AS present),
    base AS (
        -- Mirror the raw path's window exactly (most-recent 25k rows).
        SELECT fsc.request_id AS rid, fsc.miner_hotkey, fsc.lead_id,
               fsc.is_winner, fsc.computed_at
        FROM public.fulfillment_score_consensus fsc
        WHERE fsc.request_id = ANY(p_request_ids)
        ORDER BY fsc.computed_at DESC
        LIMIT 25000
    )
    SELECT b.rid AS request_id,
           b.miner_hotkey,
           COUNT(*)::bigint AS lead_count,
           COUNT(*) FILTER (
               WHERE CASE
                   WHEN (SELECT present FROM any_winner) THEN EXISTS (
                       SELECT 1 FROM chain_winners cw
                       WHERE cw.rid = b.rid AND cw.lead_id = b.lead_id)
                   ELSE b.is_winner
               END
           )::bigint AS win_count,
           MAX(b.computed_at) AS last_computed_at
    FROM base b
    GROUP BY b.rid, b.miner_hotkey;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_fulfillment_graph_summary(uuid[]) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_fulfillment_graph_summary(uuid[]) TO anon;
GRANT EXECUTE ON FUNCTION public.get_fulfillment_graph_summary(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_fulfillment_graph_summary(uuid[]) TO service_role;
