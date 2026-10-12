import fs from "node:fs/promises";
import path from "node:path";
import { getSubmission, updateSubmission, type SubmissionRow, type SubmissionVibeColumns } from "../db/queries/submissions";
import { upsertAnalysis } from "../db/queries/analyses";
import { downloadToTmp, playbackPathFor, uploadPlayback } from "../media/storage";
import { extractMedia } from "../media/extract";
import { transcodeForPlayback } from "../media/transcode";
import { transcribe } from "./transcribe";
import { analyzeVideo, type AnalyzeInput } from "./analyzeVideo";
import { buildVideoProfile, voiceEnergy, PROMPT_VERSION as PROFILE_VERSION } from "./videoProfile";
import { measurePacing } from "../media/pacing";
import { listenWithGemini } from "./geminiAudio";
import { readFaces } from "../media/faces";
import { ENGINE } from "../shared/config";
import { logEvent } from "../feedback/events";
import { PipelineError } from "../shared/errors";
import { logger } from "../shared/logger";
import type { StageCtx } from "../pipeline/budget";

export type AnalyzeDeps = {
  getSubmission: typeof getSubmission;
  downloadToTmp: typeof downloadToTmp;
  extractMedia: typeof extractMedia;
  transcodeForPlayback: typeof transcodeForPlayback;
  uploadPlayback: typeof uploadPlayback;
  readFrame: (framePath: string) => Promise<string>;
  transcribe: typeof transcribe;
  analyzeVideo: typeof analyzeVideo;
  upsertAnalysis: typeof upsertAnalysis;
  updateSubmission: typeof updateSubmission;
  logEvent: typeof logEvent;
  removeDir: (dir: string) => Promise<void>;
  /** New engine (Dylan, 2026-10-11): pacing + video profile run only when ENGINE is "new". */
  engine: "old" | "new";
  measurePacing: typeof measurePacing;
  buildVideoProfile: typeof buildVideoProfile;
  /** New engine audio = Gemini (Dylan, 2026-10-11): words, voice energy and mood, speech speed. */
  listenWithGemini: typeof listenWithGemini;
  /** Faces in v1 (Dylan): YuNet + HSEmotion on the server. */
  readFaces: typeof readFaces;
};

const defaultDeps: AnalyzeDeps = {
  getSubmission,
  downloadToTmp,
  extractMedia,
  transcodeForPlayback,
  uploadPlayback,
  readFrame: async (p) => (await fs.readFile(p)).toString("base64"),
  transcribe,
  analyzeVideo,
  upsertAnalysis,
  updateSubmission,
  logEvent,
  removeDir: async (dir) => fs.rm(dir, { recursive: true, force: true }),
  engine: ENGINE,
  measurePacing,
  buildVideoProfile,
  listenWithGemini,
  readFaces,
};

/** Tags (0008) plus the "Anything else?" note (creator_intent); null when the creator gave neither. */
function creatorVibe(sub: SubmissionRow): AnalyzeInput["creatorVibe"] {
  // Cast until `pnpm db:types` includes 0008_vibe.sql; rows before 0008 have no tags.
  const tags = (sub as SubmissionRow & Partial<SubmissionVibeColumns>).vibe_tags ?? [];
  const note = sub.creator_intent?.trim() || null;
  return tags.length > 0 || note ? { tags, note } : null;
}

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

  const tDownload = Date.now();
  const videoPath = await d.downloadToTmp(sub.video_path);
  logger.info("media.downloaded", { submissionId, ms: Date.now() - tDownload });
  // New engine: pacing needs only the file, so it starts now (a failure only drops that source).
  const soft = <T,>(what: string, p: Promise<T>) => {
    const t = Date.now();
    return p.then((v) => { logger.info(`media.${what}`, { submissionId, ms: Date.now() - t }); return v; }, (err: unknown) => {
      logger.warn(`media.${what}_failed`, { submissionId, ms: Date.now() - t, reason: err instanceof Error ? err.message : String(err) });
      return null;
    });
  };
  const pacingP = d.engine === "new" ? soft("pacing", d.measurePacing(videoPath)) : Promise.resolve(null);
  const workDir = path.dirname(videoPath);
  try {
    const media = await d.extractMedia(videoPath, { workDir, deadlineAt: ctx.deadlineAt });

    // H.264 playback copy for Android/desktop browsers. Started now so ffmpeg runs while Whisper and
    // Claude are on the network; awaited only after the analysis is persisted. Best effort: never fails the stage.
    const t0 = Date.now();
    const transcoding = d.transcodeForPlayback(videoPath, workDir, ctx.deadlineAt).catch((err: unknown) => {
      logger.warn("media.transcode_failed", { submissionId, reason: err instanceof Error ? err.message : String(err) });
      return null;
    });

    const frames = await Promise.all(
      media.frames.map(async (f) => ({ time: f.time, base64: await d.readFrame(f.path) })),
    );
    // Faces need the duration, so they start right after extraction and run alongside Gemini.
    const facesP = d.engine === "new" ? soft("faces", d.readFaces(videoPath, media.durationSeconds)) : Promise.resolve(null);
    // New engine: Gemini listens (words + voice). Old engine: Whisper. Silent videos have no audio track: skip both.
    const heard = d.engine === "new" && media.audioPath ? await d.listenWithGemini(media.audioPath, { deadlineAt: ctx.deadlineAt }) : null;
    const transcript = heard ? heard.transcript : media.audioPath && d.engine !== "new"
      ? await d.transcribe(media.audioPath, { deadlineAt: ctx.deadlineAt })
      : { text: "", segments: [] };
    const input: AnalyzeInput = {
      frames,
      transcript: transcript.text,
      transcriptSegments: transcript.segments,
      creatorVibe: creatorVibe(sub),
      durationSeconds: media.durationSeconds,
    };
    // The analysis and profile calls start as soon as Gemini's words are in; pacing and faces are awaited inside
    // the profile only for the energy/mood combine.
    const [result, profile] = await Promise.all([
      d.analyzeVideo(input, { deadlineAt: ctx.deadlineAt }),
      d.engine === "new"
        ? d.buildVideoProfile(input, pacingP, { deadlineAt: ctx.deadlineAt, voice: heard?.voice ? { energy: voiceEnergy(heard.voice.energy, heard.wordsPerSecond), mood: heard.voice.mood } : null, voiceFeelings: heard?.feelings ?? null, faces: facesP.then((f) => (f ? { energy: f.energy, mood: f.mood } : null)) })
        : Promise.resolve(null),
    ]);
    const [pacing, faces] = await Promise.all([pacingP, facesP]);

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
      // 0012 columns: cast until `pnpm db:types` includes 0012_new_engine.sql.
      ...(profile ? { video_profile: { reading: profile.reading, pacing: profile.pacing, voice: heard ? { ...heard.voice, words_per_second: heard.wordsPerSecond, laughter: heard.laughter, sarcasm: heard.sarcasm } : null, faces, energy: profile.energy, mood: profile.mood }, measured_pacing: pacing, profile_prompt_version: PROFILE_VERSION } : {}),
    } as Parameters<typeof d.upsertAnalysis>[0]);

    try {
      const playbackLocal = await transcoding;
      if (playbackLocal) {
        const playbackPath = playbackPathFor(sub.video_path);
        // Cap the storage round-trips too, so a hung upload cannot eat the rest of the budget.
        const capped = <T,>(p: Promise<T>, ms: number) =>
          Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms} ms`)), ms))]);
        await capped(d.uploadPlayback(playbackPath, playbackLocal), 20_000);
        await capped(d.updateSubmission(submissionId, { playback_path: playbackPath }), 10_000);
        const bytes = (await fs.stat(playbackLocal).catch(() => null))?.size ?? 0;
        logger.info("media.transcoded", { submissionId, ms: Date.now() - t0, bytes });
      }
    } catch (err) {
      logger.warn("media.transcode_failed", { submissionId, reason: err instanceof Error ? err.message : String(err) });
    }

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
