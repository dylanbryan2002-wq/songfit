-- Two creators, three submissions, repeated events, one paid.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'fixture-a@songfit.test'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'fixture-b@songfit.test')
on conflict (id) do nothing;
-- the auth->creators trigger (Phase 0) mirrors these; ensure explicitly:
insert into creators (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'fixture-a@songfit.test'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'fixture-b@songfit.test')
on conflict (id) do nothing;

insert into submissions (id, creator_id, video_path, status, content_category, created_at, recommended_at) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001/1.mp4', 'ready', 'fashion', now() - interval '10 min', now() - interval '8 min'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001/2.mp4', 'ready', 'fashion', now() - interval '6 min',  now() - interval '4 min'),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002/3.mp4', 'ready', 'fitness', now() - interval '5 min',  now() - interval '3 min');

insert into events (creator_id, submission_id, name, metadata, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'submission_created', null, now() - interval '10 min'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'recommendations_ready', null, now() - interval '8 min'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'recommendations_viewed', null, now() - interval '7 min'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'recommendations_viewed', null, now() - interval '7 min'), -- repeated view
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'recommendation_selected', '{"rank":1}', now() - interval '6 min'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'submission_created', null, now() - interval '6 min'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'recommendations_ready', null, now() - interval '4 min'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000003', 'submission_created', null, now() - interval '5 min'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000003', 'recommendations_ready', null, now() - interval '3 min'),
  ('aaaaaaaa-0000-0000-0000-000000000002', null, 'paid_offer_viewed', null, now() - interval '2 min'),
  ('aaaaaaaa-0000-0000-0000-000000000002', null, 'paid', '{"stripeSubscriptionId":"sub_fixture"}', now() - interval '1 min');

insert into subscriptions (creator_id, stripe_customer_id, stripe_subscription_id, status, started_at) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cus_fixture', 'sub_fixture', 'active', now() - interval '1 min')
on conflict (stripe_subscription_id) do nothing;
