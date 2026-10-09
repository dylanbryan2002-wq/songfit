-- Usage ledger (docs/review/25-accounts-rulings.md). See docs/DATA_MODEL.md → usage.
-- Creators can now delete videos. If the 24 h caps kept counting submissions, a delete would hand the
-- upload back. The caps count this append-only ledger instead: one row per created submission.

create table public.usage (
  id uuid primary key default gen_random_uuid(),
  -- No foreign key on purpose: the row must outlive the submission and the creator it counts, or
  -- deleting either would restore the allowance. It holds a bare uuid, no content.
  creator_id uuid not null,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('submission'))
);

create index usage_creator_id_created_at_idx on public.usage (creator_id, created_at);

-- Service role and create_submission() only.
alter table public.usage enable row level security;
revoke all on public.usage from anon, authenticated;

-- Backfill: the submissions still inside the rolling 24 h window keep counting.
insert into public.usage (creator_id, created_at, kind)
select creator_id, created_at, 'submission' from public.submissions
where created_at > now() - interval '24 hours';

-- create_submission(): 0010's body, with both caps counted from usage and a usage row inserted in the
-- same transaction as the submission. Locks, error names and the paywall check unchanged.
-- The literals below must match src/shared/config.ts (LIMITS.dailyUploadsPerCreator = 10,
-- LIMITS.dailyUploadsAnonymous = 3, LIMITS.globalDailySubmissions = 150);
-- tests/shared/limitsMatchMigration.test.ts reads this file and checks them.
create or replace function public.create_submission(
  p_id uuid,
  p_creator_id uuid,
  p_video_path text,
  p_intent text
)
returns public.submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.submissions;
  used_count int;
  daily_count int;
  daily_cap int;
  global_count int;
  subscribed boolean;
  created public.submissions;
begin
  -- Global lock first (the site-wide ceiling needs it), then the per-creator lock, always in this order.
  perform pg_advisory_xact_lock(hashtext('create_submission:global'));
  perform pg_advisory_xact_lock(hashtext(p_creator_id::text));

  -- Idempotent: the same creator re-posting the same id gets the same row (and no second usage row).
  select * into existing from public.submissions where id = p_id;
  if found then
    if existing.creator_id <> p_creator_id then
      raise exception 'forbidden';
    end if;
    return existing;
  end if;

  -- Per-creator daily cap: 10 (dailyUploadsPerCreator), 3 for an anonymous creator (dailyUploadsAnonymous).
  select case when c.email is null then 3 else 10 end into daily_cap
  from public.creators c where c.id = p_creator_id;
  select count(*) into daily_count
  from public.usage
  where creator_id = p_creator_id and created_at > now() - interval '24 hours';
  if daily_count >= coalesce(daily_cap, 3) then
    raise exception 'daily_limit';
  end if;

  -- Global ceiling: 150 submissions site-wide per rolling 24 h (globalDailySubmissions).
  select count(*) into global_count
  from public.usage
  where created_at > now() - interval '24 hours';
  if global_count >= 150 then
    raise exception 'global_limit';
  end if;

  select count(*) into used_count
  from public.submissions
  where creator_id = p_creator_id
    and (
      status = 'ready'
      or (status in ('uploaded', 'analyzing', 'recommending')
          and updated_at > now() - interval '10 minutes')
    );

  select exists (
    select 1 from public.subscriptions
    where creator_id = p_creator_id and status = 'active'
  ) into subscribed;

  -- Paywall off: 1000 free results per creator until Stripe ships.
  if used_count >= 1000 and not subscribed then
    raise exception 'needs_subscription';
  end if;

  insert into public.submissions (id, creator_id, video_path, creator_intent, status)
  values (p_id, p_creator_id, p_video_path, p_intent, 'uploaded')
  returning * into created;

  insert into public.usage (creator_id, kind)
  values (p_creator_id, 'submission');
  return created;
end;
$$;

revoke execute on function public.create_submission(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_submission(uuid, uuid, text, text) to service_role;
