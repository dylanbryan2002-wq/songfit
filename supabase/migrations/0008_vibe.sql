-- "What's the vibe?" step: up to 3 creator-picked chips, fed to analysis. The "Anything else?"
-- note reuses creator_intent.
alter table public.submissions add column vibe_tags text[] not null default '{}';
