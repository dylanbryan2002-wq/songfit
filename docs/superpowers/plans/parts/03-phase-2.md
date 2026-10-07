## Phase 2 — Analysis

**Demo when done:** a real Reel uploaded from an iPhone over cellular to the DEPLOYED app moves `uploaded → analyzing → recommending`; `/admin/submissions/[id]` shows the video, a sensible structured analysis, the transcript and a music brief. `pnpm typecheck && pnpm test && pnpm build` pass.

Assumes Phase 0 delivered: `src/shared/{types,config,errors,logger}.ts` (`logger` is the export name), `src/shared/json.ts` (`extractJson(text): unknown` — strips fences, finds the first `{` or `[`, `JSON.parse`, throws with the raw text attached), `src/shared/anthropic.ts` (`callClaude`, used by Phase 3's text-only stages; Task 2.3 keeps its own client because it sends image blocks), `src/db/queries/*` (`getSubmission`, `setSubmissionStatus(id, status, error?)`, `claimSubmissionRun(id)`, `updateSubmission`, `upsertAnalysis`, `getAnalysisRow`, `getAnalysis`, `listRecommendations`, `listSubmissions`), the `video_analyses.content_category` column, and `submissions.updated_at` (used by `claimSubmissionRun`). Assumes Phase 1 delivered `src/media/storage.ts` (`downloadToTmp` into a fresh private dir, `getSignedPlaybackUrl`), `src/feedback/events.ts` (`logEvent`), `src/auth/session.ts` (`requireAdmin`), and a stub `src/pipeline/run.ts`.

`PipelineError` (Phase 0, `src/shared/errors.ts`) has the shape:

```ts
export class PipelineError extends Error {
  constructor(public stage: "analyze" | "recommend", message: string, public raw?: string) {
    super(message);
    this.name = "PipelineError";
  }
}
```

Deadline convention used by every stage in this phase (and by Phase 3): the runner computes `deadlineAt = started + LIMITS.pipelineBudgetMs` and passes `{ deadlineAt }` down. A stage never starts a model call or subprocess whose default timeout would overrun `deadlineAt`; it shortens the timeout to the remaining time via the `timeoutFor()` helper (Task 2.1), so the function always fails cleanly with time left to persist `failed`.

---

### Task 2.1: Media extraction (ffprobe duration, ffmpeg frames + audio)

**Files:**
- Create: `src/media/extract.ts`
- Create: `src/media/extractHelpers.ts`
- Test: `tests/media/extractHelpers.test.ts`
- Test: `tests/media/extract.integration.test.ts`
- Modify: `package.json` (add deps)

**Interfaces:**
- Consumes: `LIMITS` from `src/shared/config.ts`; `PipelineError` from `src/shared/errors.ts`; `logger`.
- Produces:
  ```ts
  export async function extractMedia(
    videoPath: string,
    opts?: { workDir?: string; deadlineAt?: number },
  ): Promise<{
    durationSeconds: number;
    frames: { time: number; path: string }[];
    audioPath: string | null;
    workDir: string;
  }>;
  export function pickFps(durationSeconds: number, maxFrames: number): number;
  export function frameTimestamps(count: number, fps: number): number[];
  /** min(defaultMs, time left until deadlineAt), never below 1000 ms; defaultMs when no deadline */
  export function timeoutFor(defaultMs: number, deadlineAt: number | undefined, now?: number): number;
  ```
- Subprocess timeouts (ruling C3): ffprobe 20 s, ffmpeg frames 90 s, ffmpeg audio 60 s. A timed-out process is killed and surfaces as `PipelineError("analyze", "ffmpeg timeout: <step>")`.
- iPhone input: Safari hands us `.mov` containing HEVC (H.265). The `ffmpeg-static` builds decode HEVC, so no transcoding step is needed; the Phase 2 deployed test (Task 2.7) proves it on Vercel.

- [ ] **Step 1: Install the ffmpeg binaries**

```bash
pnpm add ffmpeg-static ffprobe-static
pnpm add -D @types/ffprobe-static
```

Expected: both appear in `package.json` dependencies. `node -e "console.log(require('ffmpeg-static'))"` prints a path ending in `ffmpeg`.

- [ ] **Step 2: Write the failing tests for the pure helpers**

`tests/media/extractHelpers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pickFps, frameTimestamps, timeoutFor } from "../../src/media/extractHelpers";

describe("pickFps", () => {
  it("uses 1 fps for short videos", () => {
    expect(pickFps(30, 60)).toBe(1);
  });
  it("caps frames at maxFrames for long videos", () => {
    // 180 s video, 60 frames → 1 frame every 3 s
    expect(pickFps(180, 60)).toBeCloseTo(1 / 3, 5);
  });
  it("never exceeds 1 fps", () => {
    expect(pickFps(5, 60)).toBe(1);
  });
  it("throws on non-positive duration", () => {
    expect(() => pickFps(0, 60)).toThrow();
  });
});

describe("frameTimestamps", () => {
  it("maps frame index to seconds at 1 fps", () => {
    expect(frameTimestamps(3, 1)).toEqual([0, 1, 2]);
  });
  it("maps frame index to seconds at fractional fps", () => {
    expect(frameTimestamps(3, 1 / 3)).toEqual([0, 3, 6]);
  });
  it("returns empty for zero frames", () => {
    expect(frameTimestamps(0, 1)).toEqual([]);
  });
});

describe("timeoutFor", () => {
  it("returns the default when there is no deadline", () => {
    expect(timeoutFor(90_000, undefined, 0)).toBe(90_000);
  });
  it("shortens to the remaining time when the deadline is closer", () => {
    expect(timeoutFor(90_000, 50_000, 20_000)).toBe(30_000);
  });
  it("never drops below 1000 ms", () => {
    expect(timeoutFor(90_000, 10, 5)).toBe(1000);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run tests/media/extractHelpers.test.ts`
Expected: FAIL with `Cannot find module '../../src/media/extractHelpers'`

- [ ] **Step 4: Write the helpers**

`src/media/extractHelpers.ts`:

```ts
/** Frames per second to sample so that a video of `durationSeconds` yields at most `maxFrames`, never more than 1 fps. */
export function pickFps(durationSeconds: number, maxFrames: number): number {
  if (!(durationSeconds > 0)) throw new Error(`invalid duration: ${durationSeconds}`);
  return Math.min(1, maxFrames / durationSeconds);
}

/** Timestamp (seconds) of each extracted frame, given ffmpeg's `fps=` filter output order. */
export function frameTimestamps(count: number, fps: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(Math.round((i / fps) * 1000) / 1000);
  return out;
}

/**
 * Timeout to hand a subprocess or SDK call: the step's default, shortened to whatever
 * is left before the pipeline deadline, floored at 1 s so a call always gets a chance
 * to fail with a real error rather than a zero timeout.
 */
export function timeoutFor(defaultMs: number, deadlineAt: number | undefined, now: number = Date.now()): number {
  if (deadlineAt === undefined) return defaultMs;
  return Math.max(1000, Math.min(defaultMs, deadlineAt - now));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/media/extractHelpers.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 6: Write extractMedia**

`src/media/extract.ts`:

```ts
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { LIMITS } from "../shared/config";
import { PipelineError } from "../shared/errors";
import { logger } from "../shared/logger";
import { pickFps, frameTimestamps, timeoutFor } from "./extractHelpers";

const TIMEOUTS = { probe: 20_000, frames: 90_000, audio: 60_000 } as const;

function bin(): { ffmpeg: string; ffprobe: string } {
  if (!ffmpegPath) throw new PipelineError("analyze", "ffmpeg binary not found");
  const ffprobe = ffprobeStatic.path;
  if (!ffprobe) throw new PipelineError("analyze", "ffprobe binary not found");
  return { ffmpeg: ffmpegPath, ffprobe };
}

/**
 * Runs a binary with a hard timeout. On timeout Node sends SIGKILL to the child and
 * rejects with `killed: true`; we translate that into a PipelineError so the runner
 * records "ffmpeg timeout: <step>" instead of an opaque signal name.
 */
function run(file: string, args: string[], step: string, timeoutMs: number): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (!err) return resolve({ stdout: String(stdout) });
        const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
        if (e.killed || e.signal === "SIGKILL") {
          return reject(new PipelineError("analyze", `ffmpeg timeout: ${step} (${timeoutMs} ms)`));
        }
        reject(new PipelineError("analyze", `${step} failed: ${e.message}`, String(stderr).slice(0, 2000)));
      },
    );
  });
}

async function probeDuration(ffprobe: string, input: string, deadlineAt?: number): Promise<number> {
  const { stdout } = await run(
    ffprobe,
    ["-v", "error", "-show_entries", "format=duration", "-of", "json", input],
    "ffprobe duration",
    timeoutFor(TIMEOUTS.probe, deadlineAt),
  );
  const parsed = JSON.parse(stdout) as { format?: { duration?: string } };
  const d = Number(parsed.format?.duration);
  if (!Number.isFinite(d) || d <= 0) throw new PipelineError("analyze", "could not read video duration", stdout);
  return d;
}

async function hasAudioStream(ffprobe: string, input: string, deadlineAt?: number): Promise<boolean> {
  const { stdout } = await run(
    ffprobe,
    ["-v", "error", "-select_streams", "a", "-show_streams", "-of", "json", input],
    "ffprobe streams",
    timeoutFor(TIMEOUTS.probe, deadlineAt),
  );
  const parsed = JSON.parse(stdout) as { streams?: unknown[] };
  return Array.isArray(parsed.streams) && parsed.streams.length > 0;
}

export async function extractMedia(
  videoPath: string,
  opts: { workDir?: string; deadlineAt?: number } = {},
): Promise<{
  durationSeconds: number;
  frames: { time: number; path: string }[];
  audioPath: string | null;
  workDir: string;
}> {
  const { ffmpeg, ffprobe } = bin();
  const { deadlineAt } = opts;
  const dir = opts.workDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), "songfit-")));
  await fs.mkdir(dir, { recursive: true });

  const durationSeconds = await probeDuration(ffprobe, videoPath, deadlineAt);
  if (durationSeconds > LIMITS.maxDurationSeconds) {
    throw new PipelineError("analyze", `video too long: ${Math.round(durationSeconds)}s > ${LIMITS.maxDurationSeconds}s`);
  }

  const fps = pickFps(durationSeconds, LIMITS.maxFrames);
  const framePattern = path.join(dir, "frame_%03d.jpg");
  await run(
    ffmpeg,
    [
      "-hide_banner", "-loglevel", "error",
      "-i", videoPath,
      "-vf", `fps=${fps},scale=${LIMITS.frameWidth}:-2`,
      "-q:v", "4",
      framePattern,
    ],
    "ffmpeg frames",
    timeoutFor(TIMEOUTS.frames, deadlineAt),
  );
  const names = (await fs.readdir(dir)).filter((n) => /^frame_\d{3}\.jpg$/.test(n)).sort();
  const times = frameTimestamps(names.length, fps);
  const frames = names.map((n, i) => ({ time: times[i], path: path.join(dir, n) }));
  if (frames.length === 0) throw new PipelineError("analyze", "no frames extracted");

  let audioPath: string | null = null;
  if (await hasAudioStream(ffprobe, videoPath, deadlineAt)) {
    audioPath = path.join(dir, "audio.wav");
    await run(
      ffmpeg,
      [
        "-hide_banner", "-loglevel", "error",
        "-i", videoPath,
        "-vn", "-ac", "1", "-ar", "16000", "-f", "wav",
        audioPath,
      ],
      "ffmpeg audio",
      timeoutFor(TIMEOUTS.audio, deadlineAt),
    );
  }

  logger.info("media.extracted", { durationSeconds, frames: frames.length, fps, audio: audioPath !== null });
  return { durationSeconds, frames, audioPath, workDir: dir };
}
```

- [ ] **Step 7: Write the integration test (runs for real; skips only when the binary path is null)**

`ffmpeg-static` is a hard dependency, so this test runs in every environment that ran `pnpm install`. The only skip is when the package resolved no binary for this platform — and then it prints a loud warning so nobody mistakes a skip for a pass.

`tests/media/extract.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

const run = promisify(execFile);
const ffmpeg: string | null = (ffmpegPath as string | null) ?? null;

if (!ffmpeg) {
  // eslint-disable-next-line no-console
  console.warn(
    "\n!!! ffmpeg-static resolved NO binary for this platform. extract.integration is SKIPPED, which is NOT a pass. Fix the install before trusting Phase 2.\n",
  );
}

describe.skipIf(!ffmpeg)("extractMedia (integration)", () => {
  let sample: string;

  beforeAll(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "songfit-sample-"));
    sample = path.join(dir, "sample.mp4");
    // 5 s synthetic video with a 440 Hz tone so an audio stream exists.
    await run(ffmpeg!, [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc=duration=5:size=320x240:rate=30",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=5",
      "-shortest", "-pix_fmt", "yuv420p", sample,
    ]);
  });

  it("extracts duration, ~1 frame per second and a wav", async () => {
    const { extractMedia } = await import("../../src/media/extract");
    const out = await extractMedia(sample);
    expect(out.durationSeconds).toBeGreaterThan(4.5);
    expect(out.durationSeconds).toBeLessThan(5.5);
    expect(out.frames.length).toBeGreaterThanOrEqual(4);
    expect(out.frames.length).toBeLessThanOrEqual(6);
    expect(out.frames[0].time).toBe(0);
    expect(out.audioPath).toMatch(/audio\.wav$/);
    const stat = await fs.stat(out.audioPath!);
    expect(stat.size).toBeGreaterThan(1000);
  });

  it("fails with a PipelineError timeout when the deadline leaves too little time", async () => {
    const { extractMedia } = await import("../../src/media/extract");
    // A 170 s 720p clip takes several seconds to decode for frames. With ~1.5 s left before the
    // deadline, ffprobe (fast) succeeds but the frames step is capped near the 1 s floor and is killed.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "songfit-long-"));
    const long = path.join(dir, "long.mp4");
    await run(ffmpeg!, [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc=duration=170:size=1280x720:rate=30",
      "-pix_fmt", "yuv420p", "-preset", "ultrafast", long,
    ]);
    await expect(extractMedia(long, { deadlineAt: Date.now() + 1500 })).rejects.toMatchObject({
      name: "PipelineError",
      stage: "analyze",
      message: expect.stringMatching(/timeout/),
    });
  }, 60_000);
});
```

- [ ] **Step 8: Run all media tests**

Run: `pnpm vitest run tests/media`
Expected: PASS, 12 tests, no "SKIPPED" warning in the output. If the warning prints, stop and fix `pnpm install` (re-run it; check the network) — do not proceed on a skipped integration suite.

Manual check if you want to see the frames: `ls $(node -e "console.log(require('os').tmpdir())")/songfit-*/` after running the test.

- [ ] **Step 9: Typecheck and commit**

```bash
pnpm typecheck && pnpm test
git add package.json pnpm-lock.yaml src/media/extract.ts src/media/extractHelpers.ts tests/media
git commit -m "Add ffmpeg media extraction with hard timeouts"
```

---

### Task 2.2: Whisper transcription

**Files:**
- Create: `src/analysis/transcribe.ts`
- Test: `tests/analysis/transcribe.test.ts`

**Interfaces:**
- Consumes: `MODELS.whisper` from config; `env("OPENAI_API_KEY")`; `timeoutFor` from `src/media/extractHelpers.ts`.
- Produces:
  ```ts
  export type TranscriptSegment = { start: number; end: number; text: string };
  export type Transcript = { text: string; segments: TranscriptSegment[] };
  export async function transcribe(
    audioPath: string | null,
    opts?: { client?: OpenAI; deadlineAt?: number },
  ): Promise<Transcript>;
  ```
- Ruling I9: there is NO word-count dialogue heuristic. Whisper returns whatever words it hears — spoken or sung. Whether speech is *spoken dialogue* is decided by the analysis model in Task 2.3 from the timestamped transcript plus the frames; `dialogue_present` is its answer.

- [ ] **Step 1: Install the OpenAI SDK**

```bash
pnpm add openai
```

- [ ] **Step 2: Write the failing test**

`tests/analysis/transcribe.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { transcribe } from "../../src/analysis/transcribe";

describe("transcribe", () => {
  it("returns an empty transcript when there is no audio", async () => {
    expect(await transcribe(null)).toEqual({ text: "", segments: [] });
  });

  it("calls Whisper with verbose_json and maps text + segments", async () => {
    const create = vi.fn().mockResolvedValue({
      text: "  this is my new fit  ",
      segments: [
        { start: 0.0, end: 1.4, text: " this is " },
        { start: 1.4, end: 2.9, text: " my new fit " },
      ],
    });
    const client = { audio: { transcriptions: { create } } } as unknown as import("openai").default;
    const t = await transcribe(__filename, { client });
    expect(t.text).toBe("this is my new fit");
    expect(t.segments).toEqual([
      { start: 0, end: 1.4, text: "this is" },
      { start: 1.4, end: 2.9, text: "my new fit" },
    ]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "whisper-1", response_format: "verbose_json" }),
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it("tolerates a response with no segments array", async () => {
    const create = vi.fn().mockResolvedValue({ text: "hello" });
    const client = { audio: { transcriptions: { create } } } as unknown as import("openai").default;
    const t = await transcribe(__filename, { client });
    expect(t).toEqual({ text: "hello", segments: [] });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/analysis/transcribe.test.ts`
Expected: FAIL with `Cannot find module '../../src/analysis/transcribe'`

- [ ] **Step 4: Implement**

`src/analysis/transcribe.ts`:

```ts
import fs from "node:fs";
import OpenAI from "openai";
import { MODELS, env } from "../shared/config";
import { logger } from "../shared/logger";
import { timeoutFor } from "../media/extractHelpers";

export type TranscriptSegment = { start: number; end: number; text: string };
export type Transcript = { text: string; segments: TranscriptSegment[] };

const WHISPER_TIMEOUT_MS = 60_000;

let singleton: OpenAI | null = null;
function defaultClient(): OpenAI {
  if (!singleton) singleton = new OpenAI({ apiKey: env("OPENAI_API_KEY") });
  return singleton;
}

/**
 * Words Whisper hears, spoken or sung, with segment timestamps. Returns an empty
 * transcript when there is no audio track. Does NOT decide whether this is dialogue —
 * the analysis model does (Task 2.3).
 */
export async function transcribe(
  audioPath: string | null,
  opts: { client?: OpenAI; deadlineAt?: number } = {},
): Promise<Transcript> {
  if (!audioPath) return { text: "", segments: [] };
  const c = opts.client ?? defaultClient();
  const result = (await c.audio.transcriptions.create(
    {
      file: fs.createReadStream(audioPath),
      model: MODELS.whisper,
      response_format: "verbose_json",
    },
    { timeout: timeoutFor(WHISPER_TIMEOUT_MS, opts.deadlineAt) },
  )) as { text?: string; segments?: { start: number; end: number; text: string }[] };

  const text = (result.text ?? "").trim();
  const segments: TranscriptSegment[] = Array.isArray(result.segments)
    ? result.segments.map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }))
    : [];
  logger.info("analysis.transcribed", { chars: text.length, segments: segments.length });
  return { text, segments };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/analysis/transcribe.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
pnpm typecheck && pnpm test
git add package.json pnpm-lock.yaml src/analysis/transcribe.ts tests/analysis/transcribe.test.ts
git commit -m "Add Whisper transcription with timestamped segments"
```

---

### Task 2.3: Claude video analysis → VideoAnalysis + MusicBrief

**Files:**
- Create: `src/analysis/analyzeVideo.ts`
- Test: `tests/analysis/analyzeVideo.test.ts`

**Interfaces:**
- Consumes: `VideoAnalysis`, `MusicBrief`, `AnalysisResult` from `src/shared/types.ts`; `MODELS.analysis`, `LIMITS.modelTimeoutMs`, `CONTENT_CATEGORIES`, `env("ANTHROPIC_API_KEY")`; `extractJson` from `src/shared/json.ts` (Phase 0); `PipelineError`; `timeoutFor`; `TranscriptSegment` from Task 2.2.
- Produces:
  ```ts
  export const PROMPT_VERSION = "analyze-v2";
  export const MOMENT_TYPES = ["scene_change", "main_visual_reveal", "climax", "transition", "text_overlay", "beat_cut"] as const;
  export type AnalyzeInput = {
    frames: { time: number; base64: string }[];
    transcript: string;
    transcriptSegments: TranscriptSegment[];
    creatorIntent: string | null;
    durationSeconds: number;
  };
  export async function analyzeVideo(
    input: AnalyzeInput,
    opts?: { client?: Anthropic; deadlineAt?: number },
  ): Promise<AnalysisResult & { raw: string }>;
  ```
- Ruling C1: parse = `extractJson` → Zod. One retry carrying the Zod error, then `PipelineError("analyze", "model output invalid", raw)`. Nothing is silently dropped or defaulted.
- Ruling I9: the prompt distinguishes spoken dialogue from singing/lyrics; `dialogue_present` is true only for spoken words.
- `important_moments[].type` must come from `MOMENT_TYPES` (the Zod schema keeps `type: z.string()`; we enforce the list with a refinement here so the engine's alignment rule in Phase 3 can match on `main_visual_reveal | climax | transition | beat_cut`).

- [ ] **Step 1: Install the Anthropic SDK**

```bash
pnpm add @anthropic-ai/sdk
```

(No-op if Phase 0 already added it for `src/shared/anthropic.ts`.)

- [ ] **Step 2: Write the failing tests for analyzeVideo**

`tests/analysis/analyzeVideo.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { analyzeVideo, PROMPT_VERSION } from "../../src/analysis/analyzeVideo";
import type Anthropic from "@anthropic-ai/sdk";

const validPayload = {
  analysis: {
    summary: "Creator walks through NYC at night and reveals an outfit.",
    content_type: "fashion lifestyle reel",
    content_category: "fashion",
    setting: "New York at night",
    story: "walk, then outfit reveal",
    aesthetic: ["luxury", "urban"],
    mood: ["confident", "mysterious"],
    energy: "medium-high",
    pacing: "medium",
    dialogue_present: false,
    important_moments: [{ time: 7.8, type: "main_visual_reveal", note: "outfit reveal" }],
  },
  brief: {
    text: "Modern NYC fashion montage. Confident and slightly mysterious. Needs a lift around 8s.",
    fields: {
      moods: ["confident", "cool"],
      energy: 0.72,
      tempo_preference: "medium-high",
      vocal_preference: "either",
      genre_preferences: [],
      genre_avoid: [],
      dialogue_present: false,
      desired_cultural_relevance: "high",
      desired_familiarity: "recognizable_not_overused",
    },
  },
};

function fakeClient(responses: string[]): { client: Anthropic; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn();
  for (const r of responses) {
    create.mockResolvedValueOnce({ content: [{ type: "text", text: r }], stop_reason: "end_turn" });
  }
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const input = {
  frames: [{ time: 0, base64: "AAAA" }, { time: 1, base64: "BBBB" }],
  transcript: "",
  transcriptSegments: [],
  creatorIntent: null,
  durationSeconds: 12,
};

describe("analyzeVideo", () => {
  it("parses a valid response into AnalysisResult", async () => {
    const { client, create } = fakeClient([JSON.stringify(validPayload)]);
    const out = await analyzeVideo(input, { client });
    expect(out.analysis.content_category).toBe("fashion");
    expect(out.brief.fields.energy).toBe(0.72);
    expect(out.transcript).toBe("");
    expect(out.prompt_version).toBe(PROMPT_VERSION);
    expect(create).toHaveBeenCalledTimes(1);
    const [params, reqOpts] = create.mock.calls[0];
    expect(params.model).toBeDefined();
    expect(reqOpts).toEqual(expect.objectContaining({ timeout: expect.any(Number) }));
    // two image blocks, each preceded by a timestamp label
    const content = params.messages[0].content as { type: string; text?: string }[];
    expect(content.filter((b) => b.type === "image")).toHaveLength(2);
    expect(content.some((b) => b.type === "text" && b.text?.includes("t=1.0s"))).toBe(true);
  });

  it("accepts fenced JSON", async () => {
    const { client } = fakeClient(["```json\n" + JSON.stringify(validPayload) + "\n```"]);
    const out = await analyzeVideo(input, { client });
    expect(out.analysis.summary).toContain("NYC");
  });

  it("renders transcript segments with timestamps into the prompt", async () => {
    const { client, create } = fakeClient([JSON.stringify(validPayload)]);
    await analyzeVideo(
      {
        ...input,
        transcript: "okay so here is the fit",
        transcriptSegments: [{ start: 2.1, end: 4.0, text: "okay so here is the fit" }],
      },
      { client },
    );
    const content = create.mock.calls[0][0].messages[0].content as { type: string; text?: string }[];
    const joined = content.map((b) => b.text ?? "").join("\n");
    expect(joined).toContain("[2.1–4.0] okay so here is the fit");
  });

  it("retries once when the first response fails validation, then succeeds", async () => {
    const bad = JSON.stringify({ analysis: { summary: "x" }, brief: {} });
    const { client, create } = fakeClient([bad, JSON.stringify(validPayload)]);
    const out = await analyzeVideo(input, { client });
    expect(out.analysis.content_category).toBe("fashion");
    expect(create).toHaveBeenCalledTimes(2);
    const retryMessages = create.mock.calls[1][0].messages;
    expect(JSON.stringify(retryMessages)).toContain("did not match the schema");
  });

  it("rejects an important_moments type outside MOMENT_TYPES (then retries)", async () => {
    const wrongType = JSON.parse(JSON.stringify(validPayload));
    wrongType.analysis.important_moments[0].type = "vibe_shift";
    const { client, create } = fakeClient([JSON.stringify(wrongType), JSON.stringify(validPayload)]);
    const out = await analyzeVideo(input, { client });
    expect(out.analysis.important_moments[0].type).toBe("main_visual_reveal");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("throws PipelineError with raw text after two invalid responses", async () => {
    const bad = "{\"nope\": true}";
    const { client } = fakeClient([bad, bad]);
    await expect(analyzeVideo(input, { client })).rejects.toMatchObject({
      name: "PipelineError",
      stage: "analyze",
      raw: bad,
    });
  });

  it("throws PipelineError when the response is not JSON at all, twice", async () => {
    const { client } = fakeClient(["Sorry, I cannot see the video.", "Still nothing."]);
    await expect(analyzeVideo(input, { client })).rejects.toMatchObject({
      name: "PipelineError",
      stage: "analyze",
      raw: "Still nothing.",
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run tests/analysis/analyzeVideo.test.ts`
Expected: FAIL with `Cannot find module '../../src/analysis/analyzeVideo'`

- [ ] **Step 4: Implement analyzeVideo with the full prompt**

`src/analysis/analyzeVideo.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { MODELS, LIMITS, CONTENT_CATEGORIES, env } from "../shared/config";
import { VideoAnalysis, MusicBrief, type AnalysisResult } from "../shared/types";
import { PipelineError } from "../shared/errors";
import { extractJson } from "../shared/json";
import { logger } from "../shared/logger";
import { timeoutFor } from "../media/extractHelpers";
import type { TranscriptSegment } from "./transcribe";

export const PROMPT_VERSION = "analyze-v2";

export const MOMENT_TYPES = ["scene_change", "main_visual_reveal", "climax", "transition", "text_overlay", "beat_cut"] as const;
const momentTypeSet = new Set<string>(MOMENT_TYPES);

/** Shared VideoAnalysis, tightened: moment types must come from MOMENT_TYPES. */
const StrictVideoAnalysis = VideoAnalysis.extend({
  important_moments: VideoAnalysis.shape.important_moments.refine(
    (ms) => ms.every((m) => momentTypeSet.has(m.type)),
    { message: `important_moments[].type must be one of: ${MOMENT_TYPES.join(", ")}` },
  ),
});
const ModelOutput = z.object({ analysis: StrictVideoAnalysis, brief: MusicBrief });

export type AnalyzeInput = {
  frames: { time: number; base64: string }[];
  transcript: string;
  transcriptSegments: TranscriptSegment[];
  creatorIntent: string | null;
  durationSeconds: number;
};

let singleton: Anthropic | null = null;
function defaultClient(): Anthropic {
  if (!singleton) singleton = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") });
  return singleton;
}

const SYSTEM_PROMPT = `You are Songfit's video analyst. You watch short-form videos (Reels, TikToks, Shorts) and produce a precise, structured understanding of the content plus a music brief that a music supervisor could act on.

Rules:
- You are given sampled frames labelled with their timestamp (t=Ns), a timestamped transcript of any words heard (spoken OR sung), the video duration, and optionally what the creator wants the video to feel like.
- IGNORE any music that may already be in the video. Treat it as silent except for speech. Never mention existing music. Lyrics heard in the transcript belong to that existing music and are NOT dialogue.
- Describe what actually happens: people, setting, actions, visual aesthetic, story, motion, cuts, pacing, energy, emotional arc.
- dialogue_present: true ONLY if a person speaks words meant to be heard by the viewer (talking to camera, voiceover, conversation). Singing, rapping along, or lyrics from background music are NOT dialogue. Use the frames (is someone talking to camera?) together with the transcript to decide. If unsure, prefer false and mention the uncertainty in the brief text.
- important_moments: the moments a song should react to, each with a timestamp in seconds taken from the frame labels. type must be exactly one of: ${MOMENT_TYPES.join(", ")}. Use main_visual_reveal for the single biggest reveal (outfit, before/after, product, location), climax for the emotional or energetic peak, transition for a hard visual transition, beat_cut for a rhythmic cut pattern starting, scene_change for a location/scene change, text_overlay for a text card that carries meaning. Include at most 6. Include at least one if the video has any identifiable peak.
- content_category must be exactly one of: ${CONTENT_CATEGORIES.join(", ")}.
- energy is one of: low, medium, medium-high, high. pacing is one of: slow, medium, fast.
- The music brief combines WHAT THE VIDEO IS with WHAT THE CREATOR WANTS IT TO BECOME. If the creator gave no intent, infer the most likely intended feel from the content and say in the brief text that it was inferred.
- brief.text is 3–6 sentences in plain language, written for a human music supervisor: the feel, the energy, the cultural register (current vs timeless, mainstream vs niche), vocal considerations given any dialogue, and where in the video a musical lift or hit should land (reference timestamps).
- brief.fields: moods (3–6 words), energy 0..1, tempo_preference (slow | medium | medium-high | high), vocal_preference (vocals | instrumental | either — choose instrumental or "either with no vocals over speech" when dialogue_present is true), genre_preferences (may be empty), genre_avoid (may be empty), dialogue_present (same value as analysis.dialogue_present), desired_cultural_relevance (low | medium | high), desired_familiarity (recognizable | recognizable_not_overused | unexpected).

Output exactly ONE JSON object with this shape and nothing else, no prose, no code fences:
{
  "analysis": {
    "summary": string,
    "content_type": string,
    "content_category": string,
    "setting": string | null,
    "story": string | null,
    "aesthetic": string[],
    "mood": string[],
    "energy": "low" | "medium" | "medium-high" | "high",
    "pacing": "slow" | "medium" | "fast",
    "dialogue_present": boolean,
    "important_moments": [{ "time": number, "type": "${MOMENT_TYPES.join('" | "')}", "note"?: string }]
  },
  "brief": {
    "text": string,
    "fields": {
      "moods": string[],
      "energy": number,
      "tempo_preference": "slow" | "medium" | "medium-high" | "high",
      "vocal_preference": "vocals" | "instrumental" | "either",
      "genre_preferences": string[],
      "genre_avoid": string[],
      "dialogue_present": boolean,
      "desired_cultural_relevance": "low" | "medium" | "high",
      "desired_familiarity": "recognizable" | "recognizable_not_overused" | "unexpected"
    }
  }
}`;

type Block = Anthropic.Messages.ContentBlockParam;

function renderTranscript(input: AnalyzeInput): string {
  if (input.transcriptSegments.length > 0) {
    return input.transcriptSegments
      .map((s) => `[${s.start.toFixed(1)}–${s.end.toFixed(1)}] ${s.text}`)
      .join("\n");
  }
  return input.transcript;
}

function buildUserContent(input: AnalyzeInput): Block[] {
  const blocks: Block[] = [];
  blocks.push({
    type: "text",
    text: `Video duration: ${input.durationSeconds.toFixed(1)}s. ${input.frames.length} sampled frames follow, each labelled with its timestamp.`,
  });
  for (const f of input.frames) {
    blocks.push({ type: "text", text: `t=${f.time.toFixed(1)}s` });
    blocks.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: f.base64 },
    });
  }
  const transcript = renderTranscript(input);
  blocks.push({
    type: "text",
    text: `Words heard (spoken or sung), with [start–end] seconds. Empty means nothing was heard:\n"""${transcript}"""`,
  });
  blocks.push({
    type: "text",
    text: input.creatorIntent && input.creatorIntent.trim().length > 0
      ? `Creator intent — what they want this to feel like: """${input.creatorIntent.trim()}"""`
      : "Creator intent: none given. Infer a likely direction from the content and state in the brief that it was inferred.",
  });
  blocks.push({ type: "text", text: "Now output the single JSON object." });
  return blocks;
}

async function callModel(client: Anthropic, content: Block[], deadlineAt?: number): Promise<string> {
  const res = await client.messages.create(
    {
      model: MODELS.analysis,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    },
    { timeout: timeoutFor(LIMITS.modelTimeoutMs, deadlineAt) },
  );
  if (res.stop_reason === "max_tokens") {
    logger.warn("analysis.truncated", { stop_reason: res.stop_reason });
  }
  return res.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function tryParse(raw: string): z.infer<typeof ModelOutput> | { error: string } {
  let json: unknown;
  try {
    json = extractJson(raw);
  } catch (e) {
    return { error: `not valid JSON: ${(e as Error).message}` };
  }
  const parsed = ModelOutput.safeParse(json);
  if (!parsed.success) return { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return parsed.data;
}

export async function analyzeVideo(
  input: AnalyzeInput,
  opts: { client?: Anthropic; deadlineAt?: number } = {},
): Promise<AnalysisResult & { raw: string }> {
  const c = opts.client ?? defaultClient();
  const content = buildUserContent(input);

  const first = await callModel(c, content, opts.deadlineAt);
  let result = tryParse(first);
  let raw = first;

  if ("error" in result) {
    logger.warn("analysis.retry", { error: result.error });
    const retryContent: Block[] = [
      ...content,
      {
        type: "text",
        text: `Your previous output did not match the schema: ${result.error}. Output the corrected single JSON object only.`,
      },
    ];
    raw = await callModel(c, retryContent, opts.deadlineAt);
    result = tryParse(raw);
  }

  if ("error" in result) {
    throw new PipelineError("analyze", `model output invalid: ${result.error}`, raw);
  }

  logger.info("analysis.done", {
    category: result.analysis.content_category,
    moments: result.analysis.important_moments.length,
    dialogue: result.analysis.dialogue_present,
  });
  return {
    analysis: result.analysis,
    brief: result.brief,
    transcript: input.transcript,
    prompt_version: PROMPT_VERSION,
    raw,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/analysis/analyzeVideo.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
pnpm typecheck && pnpm test
git add package.json pnpm-lock.yaml src/analysis/analyzeVideo.ts tests/analysis/analyzeVideo.test.ts
git commit -m "Add Claude video analysis producing VideoAnalysis and MusicBrief"
```

---

### Task 2.4: analyzeSubmission orchestration and persistence

**Files:**
- Create: `src/analysis/index.ts`
- Test: `tests/analysis/analyzeSubmission.test.ts`

**Interfaces:**
- Consumes: `getSubmission(id)`, `updateSubmission(id, patch)` from `src/db/queries/submissions.ts`; `upsertAnalysis(row)` from `src/db/queries/analyses.ts`; `downloadToTmp(storagePath)` from `src/media/storage.ts`; `extractMedia`; `transcribe`; `analyzeVideo`; `logEvent`.
- Produces: `export async function analyzeSubmission(submissionId: string, ctx: { deadlineAt: number }, deps?: Partial<AnalyzeDeps>): Promise<void>;`
- Ruling C5/I7: persists `content_category` on BOTH `video_analyses` and `submissions`; `analysis_completed` carries `creatorId`.

Expected db query shapes (Phase 0):

```ts
// src/db/queries/analyses.ts — AnalysisInsert is the generated Insert type; the relevant columns:
export async function upsertAnalysis(row: {
  submission_id: string; summary: string; content_type: string; content_category: string;
  setting: string | null; story: string | null;
  aesthetic: string[]; mood: string[]; energy: string; pacing: string; dialogue_present: boolean;
  transcript: string | null; important_moments: unknown; music_brief: string; music_brief_fields: unknown;
  prompt_version: string; raw_response: unknown;
}): Promise<unknown>;
// src/db/queries/submissions.ts
export async function updateSubmission(id: string, patch: { content_category?: string; duration_seconds?: number; analyzed_at?: string; recommended_at?: string; viewed_at?: string }): Promise<void>;
```

- [ ] **Step 1: Write the failing test**

`tests/analysis/analyzeSubmission.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { analyzeSubmission } from "../../src/analysis/index";

const submission = {
  id: "sub-1",
  creator_id: "cre-1",
  video_path: "cre-1/sub-1.mp4",
  creator_intent: "make it feel luxurious",
  status: "analyzing",
};

const analysisResult = {
  analysis: {
    summary: "s", content_type: "fashion reel", content_category: "fashion", setting: null, story: null,
    aesthetic: ["luxury"], mood: ["confident"], energy: "medium-high", pacing: "medium",
    dialogue_present: false, important_moments: [{ time: 7.8, type: "main_visual_reveal" }],
  },
  brief: {
    text: "brief", fields: {
      moods: ["confident"], energy: 0.7, tempo_preference: "medium-high", vocal_preference: "either",
      genre_preferences: [], genre_avoid: [], dialogue_present: false,
      desired_cultural_relevance: "high", desired_familiarity: "recognizable_not_overused",
    },
  },
  transcript: "",
  prompt_version: "analyze-v2",
  raw: "{}",
};

const ctx = { deadlineAt: 1_000_000 };

function deps() {
  return {
    getSubmission: vi.fn().mockResolvedValue(submission),
    downloadToTmp: vi.fn().mockResolvedValue("/tmp/x/video.mp4"),
    extractMedia: vi.fn().mockResolvedValue({
      durationSeconds: 12.3,
      frames: [{ time: 0, path: "/tmp/x/frame_001.jpg" }],
      audioPath: "/tmp/x/audio.wav",
      workDir: "/tmp/x",
    }),
    readFrame: vi.fn().mockResolvedValue("QUJD"),
    transcribe: vi.fn().mockResolvedValue({ text: "", segments: [] }),
    analyzeVideo: vi.fn().mockResolvedValue(analysisResult),
    upsertAnalysis: vi.fn().mockResolvedValue(undefined),
    updateSubmission: vi.fn().mockResolvedValue(undefined),
    logEvent: vi.fn().mockResolvedValue(undefined),
    removeDir: vi.fn().mockResolvedValue(undefined),
  };
}

describe("analyzeSubmission", () => {
  it("runs the stages in order, threads the deadline, and persists every column", async () => {
    const d = deps();
    await analyzeSubmission("sub-1", ctx, d);

    expect(d.downloadToTmp).toHaveBeenCalledWith("cre-1/sub-1.mp4");
    expect(d.extractMedia).toHaveBeenCalledWith("/tmp/x/video.mp4", { workDir: "/tmp/x", deadlineAt: 1_000_000 });
    expect(d.transcribe).toHaveBeenCalledWith("/tmp/x/audio.wav", { deadlineAt: 1_000_000 });
    expect(d.analyzeVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        frames: [{ time: 0, base64: "QUJD" }],
        transcript: "",
        transcriptSegments: [],
        creatorIntent: "make it feel luxurious",
        durationSeconds: 12.3,
      }),
      { deadlineAt: 1_000_000 },
    );
    expect(d.upsertAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        submission_id: "sub-1",
        summary: "s",
        content_type: "fashion reel",
        content_category: "fashion",
        setting: null,
        story: null,
        aesthetic: ["luxury"],
        mood: ["confident"],
        energy: "medium-high",
        pacing: "medium",
        dialogue_present: false,
        transcript: "",
        important_moments: [{ time: 7.8, type: "main_visual_reveal" }],
        music_brief: "brief",
        music_brief_fields: expect.objectContaining({ energy: 0.7 }),
        prompt_version: "analyze-v2",
        raw_response: "{}",
      }),
    );
    expect(d.updateSubmission).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({ content_category: "fashion", duration_seconds: 12.3, analyzed_at: expect.any(String) }),
    );
    expect(d.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: "analysis_completed", submissionId: "sub-1", creatorId: "cre-1" }),
    );
    expect(d.removeDir).toHaveBeenCalledWith("/tmp/x");
  });

  it("cleans up the work dir even when analysis throws", async () => {
    const d = deps();
    d.analyzeVideo.mockRejectedValue(new Error("boom"));
    await expect(analyzeSubmission("sub-1", ctx, d)).rejects.toThrow("boom");
    expect(d.removeDir).toHaveBeenCalledWith("/tmp/x");
    expect(d.upsertAnalysis).not.toHaveBeenCalled();
  });

  it("throws when the submission does not exist", async () => {
    const d = deps();
    d.getSubmission.mockResolvedValue(null);
    await expect(analyzeSubmission("nope", ctx, d)).rejects.toThrow(/not found/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/analysis/analyzeSubmission.test.ts`
Expected: FAIL with `Cannot find module '../../src/analysis/index'`

- [ ] **Step 3: Implement**

`src/analysis/index.ts`:

```ts
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
  ctx: { deadlineAt: number },
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
    const transcript = await d.transcribe(media.audioPath, { deadlineAt: ctx.deadlineAt });
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
```

`downloadToTmp` (Phase 1) places the file inside its own fresh `mkdtemp` directory (`/tmp/songfit-<random>/video.<ext>`), so `path.dirname(videoPath)` is safe to delete.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/analysis/analyzeSubmission.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && pnpm test
git add src/analysis/index.ts tests/analysis/analyzeSubmission.test.ts
git commit -m "Add analyzeSubmission stage with persistence and cleanup"
```

---

### Task 2.5: The single pipeline runner — atomic claim, resume from stored outputs, deadline, failure recording

**Files:**
- Modify: `src/pipeline/run.ts` (replace the Phase 1 stub)
- Create: `src/pipeline/stages.ts`
- Test: `tests/pipeline/stages.test.ts`
- Test: `tests/pipeline/run.test.ts`

**Interfaces:**
- Consumes: `claimSubmissionRun(id)` (Phase 0: atomic conditional update that moves `uploaded | failed`, or an in-flight row whose `updated_at` is older than `LIMITS.inFlightStaleMinutes`, to `analyzing` and returns the row; returns `null` otherwise — this relies on `submissions.updated_at` from migration 0001), `setSubmissionStatus(id, status, error?)`, `getAnalysisRow(submissionId)`, `listRecommendations(submissionId)`, `analyzeSubmission(id, { deadlineAt })`, `logEvent`, `LIMITS.pipelineBudgetMs`.
- Produces:
  ```ts
  // src/pipeline/stages.ts
  export type Stage = "analyze" | "recommend" | "done";
  export function nextStage(hasAnalysis: boolean, hasRecommendations: boolean): Stage;
  // src/pipeline/run.ts
  export type StageCtx = { deadlineAt: number };
  export type RunDeps = {
    claimSubmissionRun: (id: string) => Promise<{ id: string; creator_id: string } | null>;
    getAnalysisRow: (submissionId: string) => Promise<unknown | null>;
    listRecommendations: (submissionId: string) => Promise<unknown[]>;
    setSubmissionStatus: (id: string, status: SubmissionStatus, error?: string | null) => Promise<void>;
    analyze: (id: string, ctx: StageCtx) => Promise<void>;
    recommend: (id: string, ctx: StageCtx) => Promise<void>;
    logEvent: typeof logEvent;
    now: () => number;
  };
  export async function runSubmission(submissionId: string, overrides?: Partial<RunDeps>): Promise<void>;
  ```
- **Contract with Phase 3 (ruling C3 — ONE runner):** this file is the only runner. Phase 3 does not rewrite it. Phase 3 changes exactly two lines: the import of `recommendSubmission` from `src/engine/recommend.ts`, and `defaultDeps.recommend`, which until then is `recommendNotImplemented` (throws `PipelineError("recommend", "not implemented")`). Everything else — claim, stage selection, deadline, failure recording — stays as written here. Admin retry (Task 2.6) and the submit route (Phase 1, via `waitUntil`) both call `runSubmission(id)`; the claim makes concurrent calls safe.
- Behaviour: (a) claim or return; (b) stage from stored outputs, never from the status string; (c) `deadlineAt = started + LIMITS.pipelineBudgetMs`, checked before each stage and threaded into it; (d) on any error: `failed`, `error` = message (internal, admin-only), event `pipeline_failed { stage, error }` with `creatorId`; never throws; (e) the recorded stage is the one that was running.

- [ ] **Step 1: Write the failing test for nextStage**

`tests/pipeline/stages.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextStage } from "../../src/pipeline/stages";

describe("nextStage", () => {
  it("no analysis → analyze", () => expect(nextStage(false, false)).toBe("analyze"));
  it("analysis but no recommendations → recommend", () => expect(nextStage(true, false)).toBe("recommend"));
  it("both present → done", () => expect(nextStage(true, true)).toBe("done"));
  it("recommendations without analysis is impossible but still re-analyzes", () =>
    expect(nextStage(false, true)).toBe("analyze"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/pipeline/stages.test.ts`
Expected: FAIL with `Cannot find module '../../src/pipeline/stages'`

- [ ] **Step 3: Implement nextStage**

`src/pipeline/stages.ts`:

```ts
export type Stage = "analyze" | "recommend" | "done";

/**
 * Which stage to run next, derived ONLY from persisted outputs (ruling C3): a row in
 * video_analyses means analyze is done; rows in recommendations mean recommend is done.
 * The status string is never consulted, so a crash between "write output" and
 * "update status" resumes correctly.
 */
export function nextStage(hasAnalysis: boolean, hasRecommendations: boolean): Stage {
  if (!hasAnalysis) return "analyze";
  if (!hasRecommendations) return "recommend";
  return "done";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/pipeline/stages.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing tests for runSubmission**

`tests/pipeline/run.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runSubmission } from "../../src/pipeline/run";
import { PipelineError } from "../../src/shared/errors";

function deps(over: Record<string, unknown> = {}) {
  const state = { hasAnalysis: false, hasRecs: false };
  const d = {
    claimSubmissionRun: vi.fn(async () => ({ id: "sub-1", creator_id: "cre-1" })),
    getAnalysisRow: vi.fn(async () => (state.hasAnalysis ? { id: "an-1" } : null)),
    listRecommendations: vi.fn(async () => (state.hasRecs ? [{ id: "r1" }] : [])),
    setSubmissionStatus: vi.fn(async () => undefined),
    analyze: vi.fn(async () => { state.hasAnalysis = true; }),
    recommend: vi.fn(async () => { state.hasRecs = true; }),
    logEvent: vi.fn(async () => undefined),
    now: () => 0,
    ...over,
  };
  return { d, state };
}

describe("runSubmission", () => {
  it("is a no-op when the claim fails (another run is in flight or the row is ready)", async () => {
    const { d } = deps();
    d.claimSubmissionRun.mockResolvedValue(null);
    await runSubmission("sub-1", d);
    expect(d.analyze).not.toHaveBeenCalled();
    expect(d.recommend).not.toHaveBeenCalled();
    expect(d.setSubmissionStatus).not.toHaveBeenCalled();
  });

  it("runs analyze then recommend, in order, and ends ready", async () => {
    const { d } = deps();
    const order: string[] = [];
    d.analyze.mockImplementation(async () => { order.push("analyze"); });
    d.recommend.mockImplementation(async () => { order.push("recommend"); });
    await runSubmission("sub-1", d);
    expect(order).toEqual(["analyze", "recommend"]);
    const statuses = d.setSubmissionStatus.mock.calls.map((c) => c[1]);
    expect(statuses).toEqual(["analyzing", "recommending", "ready"]);
  });

  it("threads a deadline into every stage", async () => {
    const { d } = deps({ now: () => 1_000 });
    await runSubmission("sub-1", d);
    const ctx = d.analyze.mock.calls[0][1];
    expect(ctx).toEqual({ deadlineAt: expect.any(Number) });
    expect(ctx.deadlineAt).toBeGreaterThan(1_000);
    expect(d.recommend.mock.calls[0][1]).toEqual(ctx);
  });

  it("skips analyze on retry when the analysis row exists", async () => {
    const { d, state } = deps();
    state.hasAnalysis = true;
    await runSubmission("sub-1", d);
    expect(d.analyze).not.toHaveBeenCalled();
    expect(d.recommend).toHaveBeenCalledTimes(1);
    const statuses = d.setSubmissionStatus.mock.calls.map((c) => c[1]);
    expect(statuses).toEqual(["recommending", "ready"]);
  });

  it("marks ready without running anything when both outputs already exist", async () => {
    const { d, state } = deps();
    state.hasAnalysis = true;
    state.hasRecs = true;
    await runSubmission("sub-1", d);
    expect(d.analyze).not.toHaveBeenCalled();
    expect(d.recommend).not.toHaveBeenCalled();
    expect(d.setSubmissionStatus).toHaveBeenCalledTimes(1);
    expect(d.setSubmissionStatus).toHaveBeenCalledWith("sub-1", "ready", null);
  });

  it("records a failure in analyze with stage, error and creatorId, and does not throw", async () => {
    const { d } = deps();
    d.analyze.mockRejectedValue(new PipelineError("analyze", "video too long"));
    await expect(runSubmission("sub-1", d)).resolves.toBeUndefined();
    expect(d.setSubmissionStatus).toHaveBeenLastCalledWith("sub-1", "failed", "video too long");
    expect(d.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "pipeline_failed",
        submissionId: "sub-1",
        creatorId: "cre-1",
        metadata: { stage: "analyze", error: "video too long" },
      }),
    );
    expect(d.recommend).not.toHaveBeenCalled();
  });

  it("records a failure in recommend as stage recommend, even for a plain Error", async () => {
    const { d } = deps();
    d.recommend.mockRejectedValue(new Error("deezer down"));
    await runSubmission("sub-1", d);
    expect(d.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { stage: "recommend", error: "deezer down" } }),
    );
    expect(d.setSubmissionStatus).toHaveBeenLastCalledWith("sub-1", "failed", "deezer down");
  });

  it("fails cleanly when the time budget is exhausted before a stage", async () => {
    let t = 0;
    const { d } = deps({ now: () => t });
    d.analyze.mockImplementation(async () => { t = 290_000; });
    await runSubmission("sub-1", d);
    expect(d.recommend).not.toHaveBeenCalled();
    expect(d.setSubmissionStatus).toHaveBeenLastCalledWith("sub-1", "failed", expect.stringMatching(/budget exceeded before recommend/));
    expect(d.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ stage: "recommend" }) }),
    );
  });

  it("still records failure if setSubmissionStatus itself throws once", async () => {
    const { d } = deps();
    d.analyze.mockRejectedValue(new Error("boom"));
    d.setSubmissionStatus.mockRejectedValueOnce(new Error("db hiccup")); // the 'analyzing' write fails
    await expect(runSubmission("sub-1", d)).resolves.toBeUndefined();
    expect(d.logEvent).toHaveBeenCalledWith(expect.objectContaining({ name: "pipeline_failed" }));
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `pnpm vitest run tests/pipeline/run.test.ts`
Expected: FAIL (the Phase 1 stub does not accept deps / does not call these functions)

- [ ] **Step 7: Implement runSubmission**

`src/pipeline/run.ts`:

```ts
import { claimSubmissionRun, setSubmissionStatus } from "../db/queries/submissions";
import { getAnalysisRow } from "../db/queries/analyses";
import { listRecommendations } from "../db/queries/recommendations";
import { analyzeSubmission } from "../analysis";
import { logEvent } from "../feedback/events";
import { LIMITS } from "../shared/config";
import { PipelineError } from "../shared/errors";
import { logger } from "../shared/logger";
import { nextStage, type Stage } from "./stages";
import type { SubmissionStatus } from "../shared/types";

export type StageCtx = { deadlineAt: number };

export type RunDeps = {
  claimSubmissionRun: (id: string) => Promise<{ id: string; creator_id: string } | null>;
  getAnalysisRow: (submissionId: string) => Promise<unknown | null>;
  listRecommendations: (submissionId: string) => Promise<unknown[]>;
  setSubmissionStatus: (id: string, status: SubmissionStatus, error?: string | null) => Promise<void>;
  analyze: (id: string, ctx: StageCtx) => Promise<void>;
  recommend: (id: string, ctx: StageCtx) => Promise<void>;
  logEvent: typeof logEvent;
  now: () => number;
};

// Phase 3 replaces ONLY the next line's import and the `recommend:` default below.
async function recommendNotImplemented(_id: string, _ctx: StageCtx): Promise<void> {
  throw new PipelineError("recommend", "not implemented");
}

const defaultDeps: RunDeps = {
  claimSubmissionRun,
  getAnalysisRow,
  listRecommendations,
  setSubmissionStatus,
  analyze: (id, ctx) => analyzeSubmission(id, ctx),
  recommend: recommendNotImplemented,
  logEvent,
  now: () => Date.now(),
};

const STAGE_STATUS: Record<Exclude<Stage, "done">, SubmissionStatus> = {
  analyze: "analyzing",
  recommend: "recommending",
};

/**
 * The one and only pipeline runner. Safe to call from the submit route, the run route
 * and the admin retry action concurrently: the atomic claim admits exactly one run.
 * Resumes from stored outputs. Never throws.
 */
export async function runSubmission(submissionId: string, overrides: Partial<RunDeps> = {}): Promise<void> {
  const d: RunDeps = { ...defaultDeps, ...overrides };

  const claimed = await d.claimSubmissionRun(submissionId);
  if (!claimed) {
    logger.info("run.skipped_in_flight", { submissionId });
    return;
  }

  const started = d.now();
  const ctx: StageCtx = { deadlineAt: started + LIMITS.pipelineBudgetMs };

  let stage: Stage = nextStage(
    (await d.getAnalysisRow(submissionId)) !== null,
    (await d.listRecommendations(submissionId)).length > 0,
  );
  let current: Exclude<Stage, "done"> = stage === "done" ? "recommend" : stage;

  try {
    while (stage !== "done") {
      current = stage;
      if (d.now() >= ctx.deadlineAt) {
        throw new PipelineError(current, `budget exceeded before ${current}`);
      }
      await d.setSubmissionStatus(submissionId, STAGE_STATUS[current], null);
      logger.info("pipeline.stage", { submissionId, stage: current, remainingMs: ctx.deadlineAt - d.now() });

      if (current === "analyze") {
        await d.analyze(submissionId, ctx);
        stage = "recommend";
      } else {
        await d.recommend(submissionId, ctx);
        stage = "done";
      }
    }
    await d.setSubmissionStatus(submissionId, "ready", null);
    logger.info("pipeline.ready", { submissionId, ms: d.now() - started });
  } catch (err) {
    const e = err as Error;
    const failedStage = e instanceof PipelineError ? e.stage : current;
    const message = e.message ?? String(err);
    logger.error("pipeline.failed", { submissionId, stage: failedStage, message });
    try {
      await d.setSubmissionStatus(submissionId, "failed", message);
    } catch (writeErr) {
      logger.error("pipeline.failed_write", { submissionId, error: String(writeErr) });
    }
    try {
      await d.logEvent({
        name: "pipeline_failed",
        submissionId,
        creatorId: claimed.creator_id,
        metadata: { stage: failedStage, error: message },
      });
    } catch (eventErr) {
      logger.error("pipeline.failed_event", { submissionId, error: String(eventErr) });
    }
  }
}
```

Why `current` starts as `"recommend"` when `stage === "done"`: it is never used in that case (the loop doesn't run), but TypeScript needs a value of the narrowed type; `recommend` is the more plausible stage to blame if `setSubmissionStatus("ready")` itself throws.

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm vitest run tests/pipeline`
Expected: PASS (13 tests)

- [ ] **Step 9: Commit**

```bash
pnpm typecheck && pnpm test
git add src/pipeline/run.ts src/pipeline/stages.ts tests/pipeline
git commit -m "Add single pipeline runner with atomic claim, resume and deadline"
```

---

### Task 2.6: Admin queue and inspector (analysis view)

**Files:**
- Create: `app/admin/layout.tsx`
- Create: `app/admin/page.tsx`
- Create: `app/admin/submissions/[id]/page.tsx`
- Create: `app/admin/submissions/[id]/actions.ts`
- Create: `src/db/queries/admin.ts`
- Test: `tests/db/adminFormat.test.ts`

**Interfaces:**
- Consumes: `requireAdmin()` from `src/auth/session.ts`; `listSubmissions()` (returns `SubmissionWithCreator[]`, with `creator.email`) and `getSubmission(id)` from `src/db/queries/submissions.ts`; `getAnalysisRow(submissionId)` from `src/db/queries/analyses.ts`; `getSignedPlaybackUrl(storagePath)` from `src/media/storage.ts`; `runSubmission` from `src/pipeline/run.ts`.
- Produces:
  ```ts
  // src/db/queries/admin.ts
  export function formatElapsed(fromIso: string | null, toIso: string | null): string; // "1m 12s" | "—"
  export function shortId(id: string): string; // first 8 chars
  // app/admin/submissions/[id]/actions.ts
  export async function retrySubmission(formData: FormData): Promise<void>; // server action; FormData carries `id`
  ```
- Ruling M3: `requireAdmin()` is called in the layout AND in every admin page AND in the server action. The layout gate is UX; the per-page/per-action gates are the security boundary (layouts can be bypassed by direct server-action calls and by certain routing modes).
- Raw pipeline errors (`submissions.error`) are shown here only, never to creators.

- [ ] **Step 1: Write the failing test for the formatting helpers**

`tests/db/adminFormat.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatElapsed, shortId } from "../../src/db/queries/admin";

describe("formatElapsed", () => {
  it("formats minutes and seconds", () => {
    expect(formatElapsed("2026-10-06T10:00:00Z", "2026-10-06T10:01:12Z")).toBe("1m 12s");
  });
  it("formats seconds only under a minute", () => {
    expect(formatElapsed("2026-10-06T10:00:00Z", "2026-10-06T10:00:42Z")).toBe("42s");
  });
  it("returns a dash when either side is missing", () => {
    expect(formatElapsed(null, "2026-10-06T10:00:42Z")).toBe("—");
    expect(formatElapsed("2026-10-06T10:00:00Z", null)).toBe("—");
  });
});

describe("shortId", () => {
  it("returns the first 8 characters", () => {
    expect(shortId("0f4a1c9e-1234-5678-9abc-def012345678")).toBe("0f4a1c9e");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/db/adminFormat.test.ts`
Expected: FAIL with `Cannot find module '../../src/db/queries/admin'`

- [ ] **Step 3: Implement helpers**

`src/db/queries/admin.ts`:

```ts
export function formatElapsed(fromIso: string | null, toIso: string | null): string {
  if (!fromIso || !toIso) return "—";
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/db/adminFormat.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Admin layout with the email gate**

`app/admin/layout.tsx`:

```tsx
import Link from "next/link";
import { requireAdmin } from "@/src/auth/session";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <header className="flex items-center gap-6 border-b px-6 py-3 text-sm">
        <Link href="/admin" className="font-semibold">Songfit admin</Link>
        <Link href="/admin/metrics">Metrics</Link>
        <span className="ml-auto text-neutral-500">{admin.email}</span>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
```

(`/admin/metrics` is built in Phase 4; the link 404s until then.)

- [ ] **Step 6: Queue page**

`app/admin/page.tsx`:

```tsx
import Link from "next/link";
import { requireAdmin } from "@/src/auth/session";
import { listSubmissions } from "@/src/db/queries/submissions";
import { formatElapsed, shortId } from "@/src/db/queries/admin";

export const dynamic = "force-dynamic";

export default async function AdminQueuePage() {
  await requireAdmin(); // ruling M3: every admin page gates itself, not just the layout
  const rows = await listSubmissions();
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Submissions ({rows.length})</h1>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-neutral-500">
            <tr>
              <th className="py-2 pr-4">ID</th>
              <th className="py-2 pr-4">Creator</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Category</th>
              <th className="py-2 pr-4">Created</th>
              <th className="py-2 pr-4">Upload → analyzed</th>
              <th className="py-2 pr-4">Upload → ready</th>
              <th className="py-2 pr-4">Error</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="py-2 pr-4 font-mono">
                  <Link className="underline" href={`/admin/submissions/${r.id}`}>{shortId(r.id)}</Link>
                </td>
                <td className="py-2 pr-4">{r.creator?.email ?? "—"}</td>
                <td className="py-2 pr-4">{r.status}</td>
                <td className="py-2 pr-4">{r.content_category ?? "—"}</td>
                <td className="py-2 pr-4">{new Date(r.created_at).toLocaleString()}</td>
                <td className="py-2 pr-4">{formatElapsed(r.created_at, r.analyzed_at)}</td>
                <td className="py-2 pr-4">{formatElapsed(r.created_at, r.recommended_at)}</td>
                <td className="max-w-xs truncate py-2 pr-4 text-red-700">{r.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Retry server action**

`app/admin/submissions/[id]/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/src/auth/session";
import { runSubmission } from "@/src/pipeline/run";

/**
 * Admin retry. Goes through the same claimed runner as the submit route (ruling C3), so a
 * retry while a run is still in flight is a safe no-op, and a stale in-flight row
 * (updated_at older than LIMITS.inFlightStaleMinutes) can be reclaimed.
 */
export async function retrySubmission(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("missing submission id");
  await runSubmission(id);
  revalidatePath(`/admin/submissions/${id}`);
  revalidatePath("/admin");
}
```

- [ ] **Step 8: Inspector page**

`app/admin/submissions/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireAdmin } from "@/src/auth/session";
import { getSubmission } from "@/src/db/queries/submissions";
import { getAnalysisRow } from "@/src/db/queries/analyses";
import { getSignedPlaybackUrl } from "@/src/media/storage";
import { retrySubmission } from "./actions";

export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-2 border-t py-1">
      <dt className="text-neutral-500">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export default async function SubmissionInspectorPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin(); // ruling M3
  const { id } = await params;
  const sub = await getSubmission(id);
  if (!sub) notFound();
  const analysis = await getAnalysisRow(id);
  const videoUrl = await getSignedPlaybackUrl(sub.video_path);

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-semibold">Submission {id.slice(0, 8)}</h1>
        <span className="rounded bg-neutral-100 px-2 py-1 text-sm">{sub.status}</span>
        <form action={retrySubmission}>
          <input type="hidden" name="id" value={id} />
          <button className="rounded border px-3 py-1 text-sm" type="submit">Retry pipeline</button>
        </form>
      </div>

      {/* Raw pipeline error: admin-only. Creators see a generic failed state (Phase 4). */}
      {sub.error && <p className="rounded bg-red-50 p-3 text-sm text-red-800">Error: {sub.error}</p>}

      <section className="grid gap-6 md:grid-cols-[320px_1fr]">
        <video controls playsInline className="w-full rounded bg-black" src={videoUrl} />
        <dl className="text-sm">
          <Row label="Creator intent" value={sub.creator_intent ?? "—"} />
          <Row label="Duration" value={sub.duration_seconds ? `${sub.duration_seconds.toFixed(1)}s` : "—"} />
          <Row label="Category" value={sub.content_category ?? "—"} />
          <Row label="Created" value={new Date(sub.created_at).toLocaleString()} />
          <Row label="Updated" value={new Date(sub.updated_at).toLocaleString()} />
          <Row label="Analyzed" value={sub.analyzed_at ? new Date(sub.analyzed_at).toLocaleString() : "—"} />
          <Row label="Recommended" value={sub.recommended_at ? new Date(sub.recommended_at).toLocaleString() : "—"} />
        </dl>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Analysis</h2>
        {!analysis ? (
          <p className="text-sm text-neutral-500">No analysis yet.</p>
        ) : (
          <div className="space-y-4 text-sm">
            <dl>
              <Row label="Summary" value={analysis.summary} />
              <Row label="Content type" value={analysis.content_type} />
              <Row label="Category" value={analysis.content_category} />
              <Row label="Setting" value={analysis.setting ?? "—"} />
              <Row label="Story" value={analysis.story ?? "—"} />
              <Row label="Aesthetic" value={analysis.aesthetic.join(", ")} />
              <Row label="Mood" value={analysis.mood.join(", ")} />
              <Row label="Energy / pacing" value={`${analysis.energy} / ${analysis.pacing}`} />
              <Row label="Spoken dialogue" value={analysis.dialogue_present ? "yes" : "no"} />
              <Row label="Prompt version" value={analysis.prompt_version} />
            </dl>
            <div>
              <h3 className="font-medium">Important moments</h3>
              <pre className="overflow-x-auto rounded bg-neutral-50 p-3">{JSON.stringify(analysis.important_moments, null, 2)}</pre>
            </div>
            <div>
              <h3 className="font-medium">Music brief</h3>
              <p className="whitespace-pre-wrap rounded bg-neutral-50 p-3">{analysis.music_brief}</p>
              <pre className="mt-2 overflow-x-auto rounded bg-neutral-50 p-3">{JSON.stringify(analysis.music_brief_fields, null, 2)}</pre>
            </div>
            <div>
              <h3 className="font-medium">Transcript (words heard, spoken or sung)</h3>
              <p className="whitespace-pre-wrap rounded bg-neutral-50 p-3">{analysis.transcript || "(nothing heard)"}</p>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Candidates (Phase 3)</h2>
      </section>
    </div>
  );
}
```

`getAnalysisRow` returns the generated Row type: `aesthetic` and `mood` are `string[]`, `important_moments` and `music_brief_fields` are `Json` (Supabase returns jsonb as objects already). If the generated type widens any of these to `unknown`, cast at the query boundary in `src/db/queries/analyses.ts`, not in the page.

- [ ] **Step 9: Typecheck, run dev, and check the pages**

```bash
pnpm typecheck && pnpm test && pnpm dev
```

Open `http://localhost:3000/admin` signed in as the `ADMIN_EMAILS` account. Expected: the table lists submissions. Open a submission: the video plays, "No analysis yet." shows until the pipeline has run. Signed in as a non-admin: redirected per `requireAdmin()`. Call the retry action from a non-admin session (e.g. curl the server action id): rejected by `requireAdmin()` inside the action, not only by the layout.

- [ ] **Step 10: Commit**

```bash
git add app/admin src/db/queries/admin.ts tests/db/adminFormat.test.ts
git commit -m "Add admin queue and submission inspector with analysis view"
```

---

### Task 2.7: Deployed media test from an iPhone (ruling C7)

**Files:**
- Modify: `next.config.ts` (only if the deployed run fails on ffmpeg — see Step 4)
- Modify: `docs/RESEARCH.md` (append measured elapsed time and cost)

**Interfaces:**
- Consumes: the Vercel project linked in Phase 1 (Task 1.7, deployed phone upload test), the Phase 1 submit route calling `runSubmission` via `waitUntil`, `/admin/submissions/[id]`.
- Produces: proof that `ffmpeg-static` + `ffprobe-static` execute inside a Vercel Node function on a real iPhone HEVC `.mov`, and a measured per-run cost.

This is the release gate for Phase 2. It moves the riskiest deployment unknowns — binary execution, function size, HEVC decode, 60-frame payload to the model — ahead of all admin polish.

- [ ] **Step 1: Push and deploy**

```bash
git push origin mvp
```

Expected: Vercel builds the `mvp` branch preview (or production, per Phase 1's project setup) and the build log shows no warnings about `ffmpeg-static` or `ffprobe-static` being bundled/externalised incorrectly. Note the deployment URL.

- [ ] **Step 2: Upload a real iPhone clip over cellular**

On an iPhone, Wi-Fi OFF, open the deployment URL, sign in with Google, pick a 45–60 s `.mov` shot with the iPhone camera (default HEVC), submit.

Expected: the waiting page appears; within ~90 s `/admin` (on a laptop) shows the row at `recommending`, then `failed` with error `not implemented` (the Phase 3 stub) — that failure is expected and proves the runner reached the recommend stage after a successful analyze on Vercel.

- [ ] **Step 3: Inspect**

Open the inspector. Check every box:

- [ ] The video plays (signed URL works on the deployed project).
- [ ] `Duration` is populated and within ±1 s of the clip length (ffprobe ran).
- [ ] `Analysis` shows a summary that matches the clip; `Category` is one of `CONTENT_CATEGORIES`; `Spoken dialogue` is correct for what you filmed (talk to camera for a few seconds in the clip so this is testable).
- [ ] `important_moments` has at least one entry with a `type` from `MOMENT_TYPES` and a timestamp that matches a real moment in the clip.
- [ ] `Transcript` contains the words you spoke.
- [ ] Vercel function logs (Vercel dashboard → Logs, filter by the submit route) show `media.extracted` with `frames` between 45 and 60 and `audio: true`, then `analysis.done`.

- [ ] **Step 4: If the function fails on ffmpeg, fix the deployment config (one checkbox per cause)**

Read the Vercel function log for the `pipeline.failed` line. Match the message:

- [ ] `ffmpeg binary not found` / `ENOENT`: the binary was not traced into the function bundle. In `next.config.ts` ensure BOTH of these are present (keep any existing `images.remotePatterns` from Phase 0):
  ```ts
  // next.config.ts
  import type { NextConfig } from "next";

  const nextConfig: NextConfig = {
    serverExternalPackages: ["ffmpeg-static", "ffprobe-static"],
    outputFileTracingIncludes: {
      "/api/submissions/**": ["./node_modules/ffmpeg-static/ffmpeg", "./node_modules/ffprobe-static/bin/**"],
      "/admin/**": ["./node_modules/ffmpeg-static/ffmpeg", "./node_modules/ffprobe-static/bin/**"],
    },
    // Phase 0's remotePatterns stay here.
  };
  export default nextConfig;
  ```
  Then `git commit -am "Trace ffmpeg binaries into Vercel functions"` and redeploy.
- [ ] `EACCES` (permission denied): the traced binary lost its executable bit. Add `"postinstall": "chmod +x node_modules/ffmpeg-static/ffmpeg node_modules/ffprobe-static/bin/*/*/ffprobe || true"` to `package.json` scripts, commit, redeploy.
- [ ] `Serverless Function has exceeded the unzipped maximum size` (250 MB): remove the `ffprobe-static` dependency and use `ffmpeg -i <file>` stderr parsing for duration instead — only do this if the size error actually occurs; it has not in similar projects at 60 frames/512 px.
- [ ] `ffmpeg timeout: ffmpeg frames`: the Vercel Node runtime is older/slower than expected. Confirm Project → Settings → General → Node.js Version is 20.x (not 18), redeploy. If it persists on a 60 s clip, halve `LIMITS.frameWidth` to 384 and note it in the ledger.
- [ ] Function timed out before `pipeline.failed` was written (row stuck at `analyzing`): the submit route lacks `export const maxDuration = 300;` or Fluid Compute is off (Project → Settings → Functions). Fix per Phase 1 Task 1.3 and the C7 ruling; a stuck row is reclaimable via admin Retry after `LIMITS.inFlightStaleMinutes`.

Re-run Step 2 after each fix until every Step 3 box is checked.

- [ ] **Step 5: Record measurements**

From the Vercel log line `pipeline.failed` (or `pipeline.ready` once Phase 3 lands) read the elapsed ms. From console.anthropic.com → Usage read the cost of the analysis call (expect roughly $0.05–0.15 for 60 frames at 512 px on Fable); from platform.openai.com → Usage read the Whisper cost (under $0.01 for 60 s). Append to `docs/RESEARCH.md`:

```markdown
## 2026-10-07 — First deployed analysis run (Phase 2, Task 2.7)
- Device/clip: iPhone <model>, <N> s .mov HEVC, cellular upload.
- Upload → analyzed: <X> s. Frames: <N>. Transcript chars: <N>.
- Cost: Anthropic analysis $<x.xx> (model <MODELS.analysis>), Whisper $<x.xx>.
- Deployment fixes needed: <none | list from Step 4>.
```

- [ ] **Step 6: Commit**

```bash
git add docs/RESEARCH.md next.config.ts package.json
git commit -m "Record first deployed analysis run and any deployment fixes"
git push origin mvp
```

---

### Phase 2 demo check

1. Task 2.7 completed with every Step 3 box checked on the deployed app from an iPhone over cellular.
2. Locally: `pnpm typecheck && pnpm test && pnpm build` all pass; the media integration suite ran (no SKIPPED warning).
3. In `/admin`, click "Retry pipeline" on the `failed` row. Expected: `analyze` is skipped (status jumps to `recommending`, then `failed` with `not implemented` again) — confirms resume-from-stored-outputs. Click Retry twice quickly: the second click is a no-op (`run.skipped_in_flight` in the logs) — confirms the atomic claim.
4. Measurements written to `docs/RESEARCH.md`.
