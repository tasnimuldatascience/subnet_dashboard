-- Egress reduction: aggregate the fulfillment cosmos/graph inputs in SQL.
--
-- The every-60s refresh still transferred every raw consensus row (~10.4k rows,
-- ~3.6 MB/min after column trimming) although every consumer -- the cosmos
-- constellation, the request cards, the miner directory, and the stat strips --
-- aggregates per (request, miner). This returns those aggregates directly
-- (one row per request+miner pair); raw lead rows are fetched only when a
-- request dialog opens (GET /api/fulfillment?requestId=...).
--
-- Semantics replicate the former client pipeline EXACTLY, including both parts:
--   1) base rows (the request's own consensus rows, most-recent 25k window)
--      with the chain-canonical winner override: when ANY chain winner exists,
--      a lead is a winner iff it wins anywhere in its request's recursive
--      fulfillment chain, else the row's own is_winner;
--   2) SUPPLEMENTAL chain-canonical winners: a winner living under another
--      cycle of a recycled chain is attributed to the FIRST visible request
--      (array order) whose chain contains it, unless that request already has
--      the lead among its base rows -- the former leadIdToVisibleRid
--      first-claim merge. These winners feed the constellation's win links,
--      the fulfilled tallies, and miner last-activity, so dropping them would
--      silently undercount recycled-chain wins.

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
    WITH RECURSIVE input(root_id, ord) AS (
        -- Preserve array order: supplemental winners first-claim to the
        -- EARLIEST visible request whose chain contains them (former client
        -- iteration order over allRequestIds).
        SELECT t.x, MIN(t.o)
        FROM unnest(p_request_ids) WITH ORDINALITY AS t(x, o)
        GROUP BY t.x
    ),
    chain AS (
        SELECT i.root_id, fr.request_id
        FROM input i JOIN public.fulfillment_requests fr ON fr.request_id = i.root_id
        UNION
        SELECT c.root_id, fr.request_id
        FROM public.fulfillment_requests fr JOIN chain c ON fr.successor_request_id = c.request_id
    ),
    chain_winner_rows AS (
        SELECT i.root_id AS rid, i.ord, w.lead_id, w.miner_hotkey, w.computed_at
        FROM input i
        JOIN chain c ON c.root_id = i.root_id
        JOIN public.fulfillment_score_consensus w ON w.request_id = c.request_id
        WHERE w.is_winner = true
    ),
    chain_winners AS (
        SELECT DISTINCT cw.rid, cw.lead_id FROM chain_winner_rows cw
    ),
    any_winner AS (SELECT EXISTS (SELECT 1 FROM chain_winners) AS present),
    base AS (
        -- Mirror the former raw path's window exactly (most-recent 25k rows).
        SELECT fsc.request_id AS rid, fsc.miner_hotkey, fsc.lead_id,
               fsc.is_winner, fsc.computed_at
        FROM public.fulfillment_score_consensus fsc
        WHERE fsc.request_id = ANY(p_request_ids)
        ORDER BY fsc.computed_at DESC
        LIMIT 25000
    ),
    -- First-claim per winner lead: the earliest visible request (array order)
    -- whose chain contains it.
    first_claim AS (
        SELECT DISTINCT ON (cw.lead_id)
               cw.lead_id, cw.rid, cw.miner_hotkey, cw.computed_at
        FROM chain_winner_rows cw
        ORDER BY cw.lead_id, cw.ord
    ),
    -- Supplemental: first-claimed winners NOT already among that request's base
    -- rows (the former seenKeys check). Always winners by construction.
    supplemental AS (
        SELECT fc.rid, fc.miner_hotkey, fc.computed_at
        FROM first_claim fc
        WHERE NOT EXISTS (
            SELECT 1 FROM base b
            WHERE b.rid = fc.rid AND b.lead_id = fc.lead_id
        )
    ),
    combined AS (
        SELECT b.rid, b.miner_hotkey,
               1::bigint AS leads,
               (CASE
                   WHEN (SELECT present FROM any_winner) THEN EXISTS (
                       SELECT 1 FROM chain_winners cw
                       WHERE cw.rid = b.rid AND cw.lead_id = b.lead_id)
                   ELSE b.is_winner
               END)::int::bigint AS wins,
               b.computed_at
        FROM base b
        UNION ALL
        SELECT s.rid, s.miner_hotkey, 1::bigint, 1::bigint, s.computed_at
        FROM supplemental s
    )
    SELECT cb.rid AS request_id,
           cb.miner_hotkey,
           SUM(cb.leads)::bigint AS lead_count,
           SUM(cb.wins)::bigint AS win_count,
           MAX(cb.computed_at) AS last_computed_at
    FROM combined cb
    GROUP BY cb.rid, cb.miner_hotkey;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_fulfillment_graph_summary(uuid[]) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_fulfillment_graph_summary(uuid[]) TO anon;
GRANT EXECUTE ON FUNCTION public.get_fulfillment_graph_summary(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_fulfillment_graph_summary(uuid[]) TO service_role;
