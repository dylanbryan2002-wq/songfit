import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Summary = {
  funnel: { stage: string; submissions: number; creators: number }[];
  byCategory: { category: string; ready: number; selected: number }[];
  paidCreators: number;
  paidEvents: number;
  returningCreators: number;
};

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = !!URL && !!KEY; // only `pnpm test:db` loads the secrets
const CREATORS = ["aaaaaaaa-0000-0000-0000-000000000001", "aaaaaaaa-0000-0000-0000-000000000002"];

const stageOf = (m: Summary, s: string) => m.funnel.find((f) => f.stage === s) ?? { stage: s, submissions: 0, creators: 0 };
const catOf = (m: Summary, c: string) => m.byCategory.find((x) => x.category === c) ?? { category: c, ready: 0, selected: 0 };

async function cleanup(db: SupabaseClient) {
  await db.from("subscriptions").delete().in("creator_id", CREATORS);
  await db.from("events").delete().in("creator_id", CREATORS);
  await db.from("submissions").delete().in("creator_id", CREATORS);
  await db.from("creators").delete().in("id", CREATORS);
  for (const id of CREATORS) await db.auth.admin.deleteUser(id); // fixture also inserts auth.users
}

describe.skipIf(!enabled)("metrics_summary() against the fixture (exact deltas)", () => {
  let db: SupabaseClient;
  let before: Summary;

  beforeAll(async () => {
    // Constructed only when enabled, so a missing env never throws at collection time.
    db = createClient(URL as string, KEY as string);
    await cleanup(db); // clear leftovers from any earlier aborted run
    const snap = await db.rpc("metrics_summary");
    if (snap.error) throw snap.error;
    before = snap.data as Summary;
    const sql = readFileSync("supabase/seed/metrics_fixture.sql", "utf8");
    const { error } = await db.rpc("exec_sql", { sql }); // defined in 0004_metrics.sql
    if (error) throw error;
  });

  afterAll(async () => {
    if (!db) return;
    await cleanup(db);
    // Confirm nothing is left behind on the hosted project.
    const left = await Promise.all([
      db.from("creators").select("id", { count: "exact", head: true }).in("id", CREATORS),
      db.from("submissions").select("id", { count: "exact", head: true }).in("creator_id", CREATORS),
      db.from("events").select("id", { count: "exact", head: true }).in("creator_id", CREATORS),
      db.from("subscriptions").select("id", { count: "exact", head: true }).in("creator_id", CREATORS),
    ]);
    const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
    const authLeft = (users?.users ?? []).filter((u) => CREATORS.includes(u.id)).length;
    expect([...left.map((r) => r.count), authLeft]).toEqual([0, 0, 0, 0, 0]);
  });

  it("adds exactly the fixture's distinct submissions/creators, one category row per submission, and one paid creator", async () => {
    const { data, error } = await db.rpc("metrics_summary");
    expect(error).toBeNull();
    const after = data as Summary;
    const d = (s: string, k: "submissions" | "creators") => stageOf(after, s)[k] - stageOf(before, s)[k];

    expect(d("submission_created", "submissions")).toBe(3);
    expect(d("submission_created", "creators")).toBe(2);
    expect(d("recommendations_ready", "submissions")).toBe(3);
    expect(d("recommendations_ready", "creators")).toBe(2);      // creatorId is on ready events (I7)
    expect(d("recommendations_viewed", "submissions")).toBe(1);  // two view rows, ONE submission
    expect(d("recommendation_selected", "submissions")).toBe(1);
    expect(d("paid_offer_viewed", "creators")).toBe(1);          // null submission_id, creator-level event
    expect(d("paid", "creators")).toBe(1);

    const fashion = catOf(after, "fashion").ready - catOf(before, "fashion").ready;
    expect(fashion).toBe(2);                                     // NOT multiplied by the 5 events on submission 1
    expect(catOf(after, "fashion").selected - catOf(before, "fashion").selected).toBe(1);
    expect(catOf(after, "fitness").ready - catOf(before, "fitness").ready).toBe(1);

    expect(after.paidCreators - before.paidCreators).toBe(1);
    expect(after.paidEvents - before.paidEvents).toBe(1);
    expect(after.returningCreators - before.returningCreators).toBe(1); // creator A has 2 submissions
  });
});
