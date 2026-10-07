-- Catalog tables. Created now, populated after launch. See docs/DATA_MODEL.md.
create extension if not exists vector;

create table public.songs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  artist text not null,
  deezer_id text unique,
  itunes_id text,
  genres text[] not null default '{}',
  moods text[] not null default '{}',
  aesthetics text[] not null default '{}',
  energy numeric,
  bpm numeric,
  vocal_type text,
  language text,
  cultural_tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.song_segments (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs (id) on delete cascade,
  start_seconds numeric not null,
  end_seconds numeric not null,
  label text not null
    check (label in ('intro', 'verse', 'pre-chorus', 'chorus', 'drop', 'bridge', 'break', 'hook')),
  description text not null,
  moods text[] not null default '{}',
  energy numeric,
  lyrics_snippet text,
  embedding vector(1536),
  created_at timestamptz not null default now()
);
create index song_segments_song_id_idx on public.song_segments (song_id);

create table public.song_trend_signals (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs (id) on delete cascade,
  platform text not null check (platform in ('tiktok', 'instagram')),
  popularity_score numeric not null,
  growth_score numeric not null,
  saturation_score numeric not null,
  content_categories text[] not null default '{}',
  observed_at timestamptz not null default now(),
  source text not null check (source in ('manual', 'api')),
  created_at timestamptz not null default now()
);
create index song_trend_signals_song_id_idx on public.song_trend_signals (song_id);

alter table public.candidates
  add constraint candidates_song_id_fkey
  foreign key (song_id) references public.songs (id) on delete set null;
alter table public.candidates
  add constraint candidates_segment_id_fkey
  foreign key (segment_id) references public.song_segments (id) on delete set null;
