-- Songfit core tables, functions and bucket. See docs/DATA_MODEL.md.
create extension if not exists "pgcrypto";

-- creators -----------------------------------------------------------------
create table public.creators (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text,
  preferences jsonb,
  created_at timestamptz not null default now()
);

-- Mirror every new auth user into creators.
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
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- shared updated_at trigger ------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- submissions --------------------------------------------------------------
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators (id) on delete cascade,
  video_path text not null,
  duration_seconds numeric,
  creator_intent text,
  content_category text,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'analyzing', 'recommending', 'ready', 'failed')),
  error text,
  analyzed_at timestamptz,
  recommended_at timestamptz,
  viewed_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index submissions_creator_id_idx on public.submissions (creator_id);
create index submissions_status_idx on public.submissions (status);
create index submissions_created_at_idx on public.submissions (created_at desc);

create trigger submissions_set_updated_at
before update on public.submissions
for each row execute function public.set_updated_at();

-- video_analyses -----------------------------------------------------------
create table public.video_analyses (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.submissions (id) on delete cascade,
  summary text not null,
  content_type text not null,
  content_category text,
  setting text,
  story text,
  aesthetic text[] not null default '{}',
  mood text[] not null default '{}',
  energy text not null,
  pacing text not null,
  dialogue_present boolean not null default false,
  transcript text,
  important_moments jsonb not null default '[]'::jsonb,
  music_brief text not null,
  music_brief_fields jsonb not null,
  prompt_version text not null,
  raw_response jsonb,
  created_at timestamptz not null default now()
);

-- candidates ---------------------------------------------------------------
create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  song_id uuid,     -- FK to songs added in 0002_catalog.sql
  segment_id uuid,  -- FK to song_segments added in 0002_catalog.sql
  title text not null,
  artist text not null,
  canonical_title text,
  canonical_artist text,
  deezer_id text,
  itunes_id text,
  duration_seconds numeric,
  verified boolean not null default false,
  proposed_start numeric not null,
  proposed_end numeric not null,
  anchor_seconds numeric not null,
  section_is_vocal boolean not null default false,
  section_reason text not null,
  fit_reason text not null,
  directions text[] not null default '{}',
  artwork_url text,
  deezer_url text,
  preview_url text,
  preview_source text check (preview_source in ('deezer', 'itunes')),
  source text not null default 'model' check (source in ('model', 'catalog')),
  aligned_to_moment numeric,
  component_scores jsonb,
  total_score numeric,
  prompt_version text not null,
  created_at timestamptz not null default now()
);
create index candidates_submission_id_idx on public.candidates (submission_id);

-- recommendations ----------------------------------------------------------
create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  candidate_id uuid references public.candidates (id) on delete set null,
  rank int not null check (rank in (1, 2, 3)),
  direction_label text not null,
  title text not null,
  artist text not null,
  start_seconds numeric not null,
  end_seconds numeric not null,
  explanation text not null,
  spotify_url text not null,
  deezer_url text,
  artwork_url text,
  preview_url text,
  selected boolean not null default false,
  rejected boolean not null default false,
  explain_prompt_version text,
  aligned_to_moment numeric,
  created_at timestamptz not null default now(),
  unique (submission_id, rank)
);

-- events -------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references public.creators (id) on delete set null,
  submission_id uuid references public.submissions (id) on delete set null,
  name text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index events_name_idx on public.events (name);
create index events_submission_id_idx on public.events (submission_id);
create index events_creator_id_idx on public.events (creator_id);
create index events_created_at_idx on public.events (created_at desc);

-- subscriptions ------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators (id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text unique, -- plain UNIQUE: nulls may repeat, supports ON CONFLICT upsert
  status text not null check (status in ('active', 'canceled', 'past_due')),
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index subscriptions_creator_id_idx on public.subscriptions (creator_id);

-- stripe_events ------------------------------------------------------------
-- Written only AFTER an event is processed successfully (C4 ruling).
create table public.stripe_events (
  id text primary key,
  type text not null,
  processed_at timestamptz not null default now()
);

-- paywall + insert, atomic --------------------------------------------------
-- The literal `1` is FREE_RESULTS_PER_CREATOR in src/shared/config.ts.
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

  if used_count >= 1 and not subscribed then
    raise exception 'needs_subscription';
  end if;

  insert into public.submissions (id, creator_id, video_path, creator_intent, status)
  values (p_id, p_creator_id, p_video_path, p_intent, 'uploaded')
  returning * into created;
  return created;
end;
$$;

-- atomic run claim -----------------------------------------------------------
-- Moves uploaded|failed → analyzing, or re-claims a stale in-flight row (older
-- than 6 minutes, status kept so the runner resumes from stored outputs).
-- Never touches ready. Returns null when nothing was claimed.
create or replace function public.claim_submission_run(p_id uuid)
returns public.submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.submissions;
begin
  update public.submissions
     set status = case when status in ('uploaded', 'failed') then 'analyzing' else status end,
         updated_at = now()
   where id = p_id
     and status <> 'ready'
     and (status in ('uploaded', 'failed') or updated_at < now() - interval '6 minutes')
  returning * into claimed;
  return claimed;
end;
$$;

-- Creator feedback on one rank, in ONE statement so two concurrent taps can never
-- leave two picks selected. p_selected=true → exclusive select of p_rank (clears the
-- others, clears rejected on p_rank). p_rejected=true → rejected=true, selected=false
-- on p_rank only. Returns the number of rows touched for p_rank (0 = no such rank).
create or replace function public.set_recommendation_feedback(
  p_submission_id uuid, p_rank int, p_selected boolean, p_rejected boolean
) returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if p_selected then
    update public.recommendations
       set selected = (rank = p_rank),
           rejected = case when rank = p_rank then false else rejected end
     where submission_id = p_submission_id;
  elsif p_rejected then
    update public.recommendations
       set rejected = true, selected = false
     where submission_id = p_submission_id and rank = p_rank;
  end if;
  select count(*) into v_count from public.recommendations
   where submission_id = p_submission_id and rank = p_rank;
  return v_count;
end $$;

revoke execute on function public.create_submission(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.claim_submission_run(uuid) from public, anon, authenticated;
revoke execute on function public.set_recommendation_feedback(uuid, int, boolean, boolean) from public, anon, authenticated;
grant execute on function public.create_submission(uuid, uuid, text, text) to service_role;
grant execute on function public.claim_submission_run(uuid) to service_role;
grant execute on function public.set_recommendation_feedback(uuid, int, boolean, boolean) to service_role;

-- storage ------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('videos', 'videos', false, 157286400)
on conflict (id) do nothing;
