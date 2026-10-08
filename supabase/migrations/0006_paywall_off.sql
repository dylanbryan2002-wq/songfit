-- 2026-10-07, Dylan's decision ("lift it"): Stripe is not set up, so the hard "one free result"
-- gate has no way to pay and dead-ends creators. Lift the limit until the paywall ships (Phase 4
-- Task 4.3 re-tightens it in a later migration). Only the comparison constant changes; everything
-- else is 0001's function verbatim.
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
  subscribed boolean;
  created public.submissions;
begin
  -- Serialize per creator so two concurrent uploads cannot both pass the count.
  perform pg_advisory_xact_lock(hashtext(p_creator_id::text));

  -- Idempotent: the same creator re-posting the same id gets the same row.
  select * into existing from public.submissions where id = p_id;
  if found then
    if existing.creator_id <> p_creator_id then
      raise exception 'forbidden';
    end if;
    return existing;
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
