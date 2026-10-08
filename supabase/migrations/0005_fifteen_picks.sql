-- Up to 15 ranked picks per submission (C2). The inline check from 0001 got Postgres's
-- auto name recommendations_rank_check. set_recommendation_feedback takes any p_rank, so
-- this constraint is the only bound.
alter table public.recommendations drop constraint recommendations_rank_check;
alter table public.recommendations add constraint recommendations_rank_check check (rank between 1 and 15);
