-- Row Level Security. Creators see only their own rows. Tables with no
-- policies are service-role only (the service role bypasses RLS).
-- There is deliberately NO insert policy on submissions: rows are created
-- only through create_submission() via the service role (C2 ruling).

alter table public.creators enable row level security;
create policy "creators: read own" on public.creators
  for select to authenticated using (auth.uid() = id);
create policy "creators: update own" on public.creators
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

alter table public.submissions enable row level security;
create policy "submissions: read own" on public.submissions
  for select to authenticated using (auth.uid() = creator_id);

alter table public.video_analyses enable row level security;
create policy "video_analyses: read own" on public.video_analyses
  for select to authenticated using (
    exists (
      select 1 from public.submissions s
      where s.id = video_analyses.submission_id and s.creator_id = auth.uid()
    )
  );

alter table public.candidates enable row level security;
-- no policies: service role only

alter table public.recommendations enable row level security;
create policy "recommendations: read own" on public.recommendations
  for select to authenticated using (
    exists (
      select 1 from public.submissions s
      where s.id = recommendations.submission_id and s.creator_id = auth.uid()
    )
  );

alter table public.events enable row level security;
-- no policies: service role only

alter table public.subscriptions enable row level security;
create policy "subscriptions: read own" on public.subscriptions
  for select to authenticated using (auth.uid() = creator_id);

alter table public.stripe_events enable row level security;
-- no policies: service role only

alter table public.songs enable row level security;
alter table public.song_segments enable row level security;
alter table public.song_trend_signals enable row level security;
-- no policies: service role only

-- Storage: creators upload to and read from their own folder in `videos`.
-- Signed upload URLs are issued by the server (Task 1.2); this policy scopes
-- any authenticated upload to the caller's own prefix.
create policy "videos: upload own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "videos: read own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
