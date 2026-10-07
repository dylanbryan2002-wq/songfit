-- Test helper: run a SQL script. Service role only; never exposed to clients.
create or replace function exec_sql(sql text) returns void
language plpgsql security definer set search_path = public as $$
begin execute sql; end $$;
revoke execute on function exec_sql(text) from public, anon, authenticated;
grant execute on function exec_sql(text) to service_role;

-- One-shot metrics summary for the admin page. Service role only.
-- Funnel counts DISTINCT submissions and DISTINCT creators per milestone.
-- Category breakdown aggregates submissions first (no event-join multiplication).
create or replace function metrics_summary() returns jsonb
language sql security definer set search_path = public as $$
with
event_counts as (
  select name, count(*)::int as count from events group by name
),
stages as (
  select * from (values
    ('submission_created', 1), ('recommendations_ready', 2), ('recommendations_viewed', 3),
    ('recommendation_selected', 4), ('all_rejected', 4), ('paid_offer_viewed', 5),
    ('paid_offer_clicked', 6), ('paid', 7)
  ) as t(stage, ord)
),
funnel as (
  select s.stage, s.ord,
    count(distinct e.submission_id)::int as submissions,
    count(distinct e.creator_id)::int as creators
  from stages s left join events e on e.name = s.stage
  group by s.stage, s.ord
),
upload_to_ready as (
  select extract(epoch from (recommended_at - created_at)) as secs
  from submissions where recommended_at is not null
),
ready_to_select as (
  select extract(epoch from (min(e.created_at) - s.recommended_at)) as secs
  from events e join submissions s on s.id = e.submission_id
  where e.name = 'recommendation_selected' and s.recommended_at is not null
  group by s.id, s.recommended_at
),
selected_submissions as (
  select distinct submission_id from events where name = 'recommendation_selected'
),
by_category as (
  select coalesce(s.content_category, 'unknown') as category,
    count(*) filter (where s.status = 'ready')::int as ready,
    count(*) filter (where ss.submission_id is not null)::int as selected
  from submissions s left join selected_submissions ss on ss.submission_id = s.id
  group by 1
),
paid as (
  select
    (select count(distinct creator_id)::int from subscriptions where status = 'active') as paid_creators,
    (select count(*)::int from events where name = 'paid') as paid_events
),
returning_creators as (
  select count(*)::int as n from (
    select creator_id from submissions group by creator_id having count(*) >= 2
  ) r
)
select jsonb_build_object(
  'eventCounts', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', count) order by name), '[]'::jsonb) from event_counts),
  'funnel', (select coalesce(jsonb_agg(jsonb_build_object('stage', stage, 'submissions', submissions, 'creators', creators) order by ord, stage), '[]'::jsonb) from funnel),
  'uploadToReadySeconds', (select coalesce(jsonb_agg(secs), '[]'::jsonb) from upload_to_ready),
  'readyToSelectionSeconds', (select coalesce(jsonb_agg(secs), '[]'::jsonb) from ready_to_select),
  'byCategory', (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'ready', ready, 'selected', selected) order by ready desc), '[]'::jsonb) from by_category),
  'paidCreators', (select paid_creators from paid),
  'paidEvents', (select paid_events from paid),
  'returningCreators', (select n from returning_creators)
);
$$;

revoke execute on function metrics_summary() from public, anon, authenticated;
grant execute on function metrics_summary() to service_role;
