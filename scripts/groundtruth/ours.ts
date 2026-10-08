/* Our production engine on one muted clip, every Supabase/Storage write stubbed (pattern: scripts/quality-run.ts).
   Analysis (frames + Whisper + Claude) then recommend (generate → verify → score → diversify → sections → explain). */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyzeSubmission } from "../../src/analysis/index";
import { analyzeVideo, type AnalyzeInput } from "../../src/analysis/analyzeVideo";
import { recommendSubmission } from "../../src/engine/recommend";
import { generateCandidates, type GenerateOpts } from "../../src/engine/candidates/generateCandidates";
import { verifyCandidates } from "../../src/engine/catalog/verifyCandidates";
import { scoreCandidates } from "../../src/engine/scoring/scoreCandidates";
import { diversify } from "../../src/engine/diversify/diversify";
import { selectSections } from "../../src/engine/sections/selectSections";
import { explainPicks } from "../../src/engine/explain/explainPicks";
import type { SubmissionRow } from "../../src/db/queries/submissions";
import type { CandidateInsert } from "../../src/db/queries/candidates";
import type { FinalRecommendation, GeneratedCandidate, MusicBrief, VideoAnalysis } from "../../src/shared/types";

export type OursResult = {
  analysis: VideoAnalysis;
  brief: MusicBrief;
  analysis_prompt_version: string;
  analysis_raw: string;
  generated: GeneratedCandidate[]; // every candidate the model named, both generate calls, before verification
  generate_calls: number;
  candidates: CandidateInsert[]; // every row the recommend stage would have stored: verified flag, scores, directions
  finals: FinalRecommendation[]; // the 15 picks with sections and explanations
  recommend_error: string | null; // set when the recommend stage threw after generating (e.g. fewer than 3 verified)
  elapsed_ms: number;
};

const SUBMISSION_ID = "groundtruth";

function fakeSubmission(videoPath: string, durationSeconds: number): SubmissionRow {
  const now = new Date().toISOString();
  return {
    id: SUBMISSION_ID, creator_id: "groundtruth", video_path: videoPath, playback_path: null,
    status: "analyzing", error: null, content_category: null, creator_intent: null, vibe_tags: [],
    duration_seconds: durationSeconds, analyzed_at: null, recommended_at: null, viewed_at: null,
    created_at: now, updated_at: now,
  };
}

/** Full production run on the muted file. Nothing is persisted; the deadline is the pipeline budget. */
export async function runOurs(mutedPath: string, durationSeconds: number, deadlineMs: number): Promise<OursResult> {
  const started = Date.now();
  const ctx = { deadlineAt: Date.now() + deadlineMs };
  const sub = fakeSubmission(mutedPath, durationSeconds);

  let analysed: Awaited<ReturnType<typeof analyzeVideo>> | null = null;
  await analyzeSubmission(SUBMISSION_ID, ctx, {
    getSubmission: async () => sub,
    // analyzeSubmission removes the directory holding the video when done; give it a private copy.
    downloadToTmp: async (p) => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "groundtruth-"));
      const copy = path.join(dir, path.basename(p));
      await fs.copyFile(p, copy);
      return copy;
    },
    analyzeVideo: async (input: AnalyzeInput, opts) => { analysed = await analyzeVideo(input, opts); return analysed; },
    transcodeForPlayback: async () => null,
    uploadPlayback: async () => {},
    upsertAnalysis: async () => ({}) as never,
    updateSubmission: async () => {},
    logEvent: async () => {},
  });
  if (!analysed) throw new Error("analysis produced no result");
  const { analysis, brief, prompt_version, raw } = analysed as Awaited<ReturnType<typeof analyzeVideo>>;

  const generated: GeneratedCandidate[] = [];
  let generateCalls = 0;
  let candidates: CandidateInsert[] = [];
  let finals: FinalRecommendation[] = [];
  let recommendError: string | null = null;
  try {
    await recommendSubmission(SUBMISSION_ID, ctx, {
      getSubmission: async () => sub,
      getAnalysis: async () => ({ analysis, brief, row: null }),
      generate: async (b: MusicBrief, a: VideoAnalysis, o?: GenerateOpts) => {
        generateCalls += 1;
        const g = await generateCandidates(b, a, o);
        generated.push(...g);
        return g;
      },
      verify: verifyCandidates, score: scoreCandidates, diversify, sections: selectSections,
      explain: async (picks, a, b, d) => { finals = await explainPicks(picks, a, b, d); return finals; },
      replaceCandidates: async (_id, rows) => { candidates = rows; return rows.map((r, i) => ({ ...r, id: `cand-${i}` })) as never; },
      replaceRecommendations: async () => [],
      setStatus: async () => {},
      logEvent: async () => {},
      listNotFound: async () => [], // the not-found ban list lives in Supabase; the eval does not read it
    });
  } catch (err) {
    recommendError = err instanceof Error ? err.message : String(err);
  }

  return {
    analysis, brief, analysis_prompt_version: prompt_version, analysis_raw: raw,
    generated, generate_calls: generateCalls, candidates, finals, recommend_error: recommendError,
    elapsed_ms: Date.now() - started,
  };
}
