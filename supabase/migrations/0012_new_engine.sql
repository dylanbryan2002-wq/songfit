-- New engine (Dylan, 2026-10-11; docs/DATA_MODEL.md). The video is read into the song dictionary and the closest songs win.
-- All new columns are nullable, so the old engine keeps working unchanged and rows written before this have nulls.
alter table public.video_analyses
  add column video_profile jsonb,
  add column profile_prompt_version text,
  add column measured_pacing jsonb;

-- Which engine produced a candidate or a pick, so results can be traced and the old engine switched back on.
alter table public.candidates add column engine text check (engine in ('old', 'new'));
alter table public.recommendations add column engine text check (engine in ('old', 'new'));
