-- Anonymous upload (docs/review/17-anonymous-upload-plan.md): visitors sign in anonymously, upload and
-- run, then sign in with Google at the results gate; the callback moves their rows with claim_anonymous().

-- Anonymous auth users have no email. Without this the auth trigger raises and signInAnonymously() fails.
alter table public.creators alter column email drop not null;
alter table public.creators add column claim_token_hash text unique;

-- Same body as 0001; restated so a null email is the documented case (null = anonymous creator).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.creators (id, email, display_name)
  values (
    new.id,
    new.email, -- null for anonymous sign-ins
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Moves an anonymous creator's submissions and events to the signed-in creator. One-time: the hash is
-- nulled, so a second call with the same token returns 0. Never moves from a creator with an email.
create or replace function public.claim_anonymous(p_token_hash text, p_creator_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anon uuid;
  v_moved int;
begin
  select id into v_anon from public.creators
  where claim_token_hash = p_token_hash and email is null and id <> p_creator_id
  for update;
  if v_anon is null then
    return 0;
  end if;

  update public.submissions set creator_id = p_creator_id where creator_id = v_anon;
  get diagnostics v_moved = row_count;
  update public.events set creator_id = p_creator_id where creator_id = v_anon;
  update public.creators set claim_token_hash = null where id = v_anon;
  return v_moved;
end;
$$;

revoke all on function public.claim_anonymous(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_anonymous(text, uuid) to service_role;

-- Metrics rule (0009): a creator counts only when creators.email is not null. A submission event's
-- creator is submissions.creator_id (moved by a claim), so events logged under the anonymous id still
-- count for the real creator; unclaimed runs count as submissions, never as creators.
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
    count(distinct c.id) filter (where c.email is not null)::int as creators
  from stages s
  left join events e on e.name = s.stage
  left join submissions sub on sub.id = e.submission_id
  left join creators c on c.id = coalesce(sub.creator_id, e.creator_id)
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
    select s.creator_id from submissions s join creators c on c.id = s.creator_id
    where c.email is not null
    group by s.creator_id having count(*) >= 2
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
