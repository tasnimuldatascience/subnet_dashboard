-- Egress reduction: aggregate the rejection-reason histogram in SQL.
--
-- The fulfillment refresh downloaded ~12.5k fulfillment_scores rows (~4.18 MB)
-- every minute and computed a small {reason -> count} histogram in Node. This
-- returns the SAME histogram directly (a handful of rows). Verified row-for-row
-- against the Node result on live data before wiring the route.
--
-- It reproduces the route's logic exactly:
--   * winners are chain-canonical (a lead is a winner iff it wins anywhere in its
--     recursive fulfillment_requests chain); when ANY chain winner exists the
--     chain set overrides the row's is_winner, else the row's own is_winner is used;
--   * rejection reason = trimmed non-empty failure_reason, else a failure_detail
--     substring mapping, else 'not_selected' (also when no score row exists);
--   * one score row per (request_id, lead_id): prefer a row carrying a reason,
--     then the most recent.

CREATE OR REPLACE FUNCTION public.get_rejection_reason_histogram(p_request_ids uuid[])
RETURNS TABLE(reason text, count bigint)
LANGUAGE plpgsql
STABLE
AS $function$
BEGIN
    IF p_request_ids IS NULL THEN
        RETURN;
    END IF;
    IF (SELECT count(DISTINCT x) FROM unnest(p_request_ids) AS t(x)) > 100 THEN
        RAISE EXCEPTION 'get_rejection_reason_histogram accepts at most 100 unique request ids'
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
        -- Mirror the route's consensus window exactly (most-recent 25k) so the
        -- histogram is byte-identical to the client computation at any scale.
        SELECT fsc.request_id AS rid, fsc.lead_id, fsc.is_winner
        FROM public.fulfillment_score_consensus fsc
        WHERE fsc.request_id = ANY(p_request_ids)
        ORDER BY fsc.computed_at DESC
        LIMIT 25000
    ),
    non_winners AS (
        SELECT b.rid, b.lead_id
        FROM base b, any_winner a
        WHERE CASE
                WHEN a.present THEN NOT EXISTS (
                    SELECT 1 FROM chain_winners cw
                    WHERE cw.rid = b.rid AND cw.lead_id = b.lead_id)
                ELSE b.is_winner = false
              END
    ),
    best_score AS (
        SELECT DISTINCT ON (s.request_id, s.lead_id)
               s.request_id AS rid, s.lead_id, s.failure_reason, s.failure_detail
        FROM public.fulfillment_scores s
        WHERE s.request_id = ANY(p_request_ids)
        ORDER BY s.request_id, s.lead_id,
                 (nullif(btrim(s.failure_reason),'') IS NOT NULL OR nullif(btrim(s.failure_detail),'') IS NOT NULL) DESC,
                 s.scored_at DESC
    ),
    categorized AS (
        SELECT CASE
            WHEN nullif(btrim(bs.failure_reason), '') IS NOT NULL THEN btrim(bs.failure_reason)
            WHEN bs.failure_detail ILIKE '%intent%' THEN 'insufficient_intent'
            WHEN bs.failure_detail ILIKE '%geography%' OR bs.failure_detail ILIKE '%location%' THEN 'geography_mismatch'
            WHEN bs.failure_detail ILIKE '%role%' THEN 'role_mismatch'
            WHEN bs.failure_detail ILIKE '%industry%' THEN 'industry_mismatch'
            WHEN bs.failure_detail ILIKE '%country%' THEN 'country_mismatch'
            WHEN bs.failure_detail ILIKE '%email%' THEN 'truelist_inline_verification'
            ELSE 'not_selected'
          END AS reason
        FROM non_winners nw
        LEFT JOIN best_score bs ON bs.rid = nw.rid AND bs.lead_id = nw.lead_id
    )
    SELECT c.reason, count(*)::bigint FROM categorized c GROUP BY c.reason;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_rejection_reason_histogram(uuid[]) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_rejection_reason_histogram(uuid[]) TO anon;
GRANT EXECUTE ON FUNCTION public.get_rejection_reason_histogram(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_rejection_reason_histogram(uuid[]) TO service_role;
