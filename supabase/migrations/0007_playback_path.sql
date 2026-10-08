-- H.264 playback copy of the upload (Android/desktop browsers cannot play iPhone HEVC .mov).
-- Null when the transcode failed, was skipped, or has not run.
alter table public.submissions add column playback_path text;
