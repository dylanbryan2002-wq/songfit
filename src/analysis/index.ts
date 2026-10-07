import fs from "node:fs/promises";
import path from "node:path";
import { getSubmission, updateSubmission } from "../db/queries/submissions";
import { upsertAnalysis } from "../db/queries/analyses";
import { downloadToTmp } from "../media/storage";
import { extractMedia } from "../media/extract";
import { transcribe } from "./transcribe";
import { analyzeVideo } from "./analyzeVideo";
import { logEvent } from "../feedback/events";
import { PipelineError } from "../shared/errors";
import { logger } from "../shared/logger";
import type { StageCtx } from "../pipeline/budget";

export type AnalyzeDeps = {
  getSubmission: typeof getSubmission;
  downloadToTmp: typeof downloadToTmp;
  extractMedia: typeof extractMedia;
  readFrame: (framePath: string) => Promise<string>;
  transcribe: typeof transcribe;
  analyzeVideo: typeof analyzeVideo;
  upsertAnalysis: typeof upsertAnalysis;
  updateSubmission: typeof updateSubmission;
  logEvent: typeof logEvent;
  removeDir: (dir: string) => Promise<void>;
};

const defaultDeps: AnalyzeDeps = {
  getSubmission,
  downloadToTmp,
  extractMedia,
  readFrame: async (p) => (await fs.readFile(p)).toString("base64"),
  transcribe,
  analyzeVideo,
  upsertAnalysis,
  updateSubmission,
  logEvent,
  removeDir: async (dir) => fs.rm(dir, { recursive: true, force: true }),
};

/**
 * Stage 1 of the pipeline: media → transcript → Claude analysis → video_analyses row.
 * Idempotent (upsert on submission_id). The deadline is threaded into every external call.
 */
export async function analyzeSubmission(
  submissionId: string,
  ctx: StageCtx,
  overrides: Partial<AnalyzeDeps> = {},
): Promise<void> {
  const d: AnalyzeDeps = { ...defaultDeps, ...overrides };
  const sub = await d.getSubmission(submissionId);
  if (!sub) throw new PipelineError("analyze", `submission not found: ${submissionId}`);

  const videoPath = await d.downloadToTmp(sub.video_path);
  const workDir = path.dirname(videoPath);
  try {
    const media = await d.extractMedia(videoPath, { workDir, deadlineAt: ctx.deadlineAt });
    const frames = await Promise.all(
      media.frames.map(async (f) => ({ time: f.time, base64: await d.readFrame(f.path) })),
    );
    // Silent videos have no audio track: skip Whisper.
    const transcript = media.audioPath
      ? await d.transcribe(media.audioPath, { deadlineAt: ctx.deadlineAt })
      : { text: "", segments: [] };
    const result = await d.analyzeVideo(
      {
        frames,
        transcript: transcript.text,
        transcriptSegments: transcript.segments,
        creatorIntent: sub.creator_intent ?? null,
        durationSeconds: media.durationSeconds,
      },
      { deadlineAt: ctx.deadlineAt },
    );

    await d.upsertAnalysis({
      submission_id: submissionId,
      summary: result.analysis.summary,
      content_type: result.analysis.content_type,
      content_category: result.analysis.content_category,
      setting: result.analysis.setting,
      story: result.analysis.story,
      aesthetic: result.analysis.aesthetic,
      mood: result.analysis.mood,
      energy: result.analysis.energy,
      pacing: result.analysis.pacing,
      dialogue_present: result.analysis.dialogue_present,
      transcript: result.transcript,
      important_moments: result.analysis.important_moments,
      music_brief: result.brief.text,
      music_brief_fields: result.brief.fields,
      prompt_version: result.prompt_version,
      raw_response: result.raw,
    });

    await d.updateSubmission(submissionId, {
      content_category: result.analysis.content_category,
      duration_seconds: media.durationSeconds,
      analyzed_at: new Date().toISOString(),
    });

    await d.logEvent({ name: "analysis_completed", submissionId, creatorId: sub.creator_id });
    logger.info("analysis.persisted", { submissionId });
  } finally {
    await d.removeDir(workDir);
  }
}
