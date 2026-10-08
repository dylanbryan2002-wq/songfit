-- "What's the vibe?" step: creator-picked chips and an optional one-line note, fed to analysis.
alter table public.submissions add column vibe_tags text[] not null default '{}';
alter table public.submissions add column vibe_note text check (vibe_note is null or char_length(vibe_note) <= 140);
