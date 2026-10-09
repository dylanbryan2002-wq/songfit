-- Security hardening (docs/review/22-security-audit-*.md). See docs/DATA_MODEL.md.
-- The app reads and writes every table through the service role; the browser uses the anon key
-- only for Auth and Storage uploads. RLS stays enabled on every table.

-- 1. Client policies the app never uses, which leaked data past the results gate (picks, raw model
--    output, raw errors) or let a visitor rewrite their own creators row (email squatting).
--    `candidates` never had a client policy (0003), so there is nothing to drop there.
drop policy if exists "creators: update own" on public.creators;
drop policy if exists "submissions: read own" on public.submissions;
drop policy if exists "video_analyses: read own" on public.video_analyses;
drop policy if exists "recommendations: read own" on public.recommendations;

-- 2. No client writes at all: a future accidental policy cannot reopen them.
revoke insert, update, delete on all tables in schema public from anon, authenticated;

-- 3. Storage. The insert policy stays: uploads over 6 MB use TUS with the user's own JWT
--    (components/upload.ts). It now only accepts the exact server-issued shape
--    <uid>/<uuid>.<ext>, and the bucket only accepts video types.
update storage.buckets
set allowed_mime_types = array['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm', 'video/3gpp']
where id = 'videos';

drop policy if exists "videos: upload own folder" on storage.objects;
create policy "videos: upload own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'videos'
    and name ~ ('^' || auth.uid()::text || '/[0-9a-f-]{36}\.(mp4|mov|webm|m4v)$')
  );

-- 4. create_submission(): daily cap and global ceiling under the lock, so parallel posts cannot
--    pass a count before any row exists. 0006's body otherwise, paywall check unchanged.
--    The literals below must match src/shared/config.ts (LIMITS.dailyUploadsPerCreator = 10,
--    LIMITS.dailyUploadsAnonymous = 3, LIMITS.globalDailySubmissions = 150);
--    tests/shared/limitsMatchMigration.test.ts reads this file and checks them.
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

  -- Idempotent: the same creator re-posting the same id gets the same row.
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
  from public.submissions
  where creator_id = p_creator_id and created_at > now() - interval '24 hours';
  if daily_count >= coalesce(daily_cap, 3) then
    raise exception 'daily_limit';
  end if;

  -- Global ceiling: 150 submissions site-wide per rolling 24 h (globalDailySubmissions).
  select count(*) into global_count
  from public.submissions
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
  return created;
end;
$$;

revoke execute on function public.create_submission(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_submission(uuid, uuid, text, text) to service_role;
