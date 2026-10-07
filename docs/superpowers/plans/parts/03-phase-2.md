## Phase 2 — Analysis

**Demo when done:** upload a real Reel; status moves `uploaded → analyzing → recommending`; `/admin/submissions/[id]` shows the video, a sensible structured analysis, the transcript and a music brief.

Assumes Phases 0–1 delivered: scaffold, `src/shared/{types,config,errors,logger}.ts`, `src/db/queries/*` (`getSubmission`, `setSubmissionStatus`, `upsertAnalysis`, `getAnalysis`, `listSubmissions`, `updateSubmission`), `src/media/storage.ts` (`downloadToTmp`, `getSignedPlaybackUrl`), `src/feedback/events.ts` (`logEvent`), `src/auth/session.ts` (`requireAdmin`), and a stub `src/pipeline/run.ts`.

`PipelineError` (from Phase 0, `src/shared/errors.ts`) has the shape:

```ts
export class PipelineError extends Error {
  constructor(public stage: "analyze" | "recommend", message: string, public raw?: string) {
    super(message);
    this.name = "PipelineError";
  }
}
```

---

### Task 2.1: Media extraction (ffprobe duration, ffmpeg frames + audio)

**Files:**
- Create: `src/media/extract.ts`
- Create: `src/media/extractHelpers.ts`
- Test: `tests/media/extractHelpers.test.ts`
- Test: `tests/media/extract.integration.test.ts`
- Modify: `package.json` (add deps)

**Interfaces:**
- Consumes: `LIMITS` from `src/shared/config.ts`; `PipelineError` from `src/shared/errors.ts`.
- Produces:
  ```ts
  export async function extractMedia(videoPath: string, workDir?: string): Promise<{
    durationSeconds: number;
    frames: { time: number; path: string }[];
    audioPath: string | null;
    workDir: string;
  }>;
  export function pickFps(durationSeconds: number, maxFrames: number): number;
  export function frameTimestamps(count: number, fps: number): number[];
  ```

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
import { pickFps, frameTimestamps } from "../../src/media/extractHelpers";

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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/media/extractHelpers.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Write extractMedia**

`src/media/extract.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { LIMITS } from "../shared/config";
import { PipelineError } from "../shared/errors";
import { logger } from "../shared/logger";
import { pickFps, frameTimestamps } from "./extractHelpers";

const run = promisify(execFile);

function bin(): { ffmpeg: string; ffprobe: string } {
  if (!ffmpegPath) throw new PipelineError("analyze", "ffmpeg binary not found");
  const ffprobe = ffprobeStatic.path;
  if (!ffprobe) throw new PipelineError("analyze", "ffprobe binary not found");
  return { ffmpeg: ffmpegPath, ffprobe };
}

async function probeDuration(ffprobe: string, input: string): Promise<number> {
  const { stdout } = await run(ffprobe, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "json",
    input,
  ]);
  const parsed = JSON.parse(stdout) as { format?: { duration?: string } };
  const d = Number(parsed.format?.duration);
  if (!Number.isFinite(d) || d <= 0) throw new PipelineError("analyze", "could not read video duration", stdout);
  return d;
}

async function hasAudioStream(ffprobe: string, input: string): Promise<boolean> {
  const { stdout } = await run(ffprobe, [
    "-v", "error",
    "-select_streams", "a",
    "-show_streams",
    "-of", "json",
    input,
  ]);
  const parsed = JSON.parse(stdout) as { streams?: unknown[] };
  return Array.isArray(parsed.streams) && parsed.streams.length > 0;
}

export async function extractMedia(
  videoPath: string,
  workDir?: string,
): Promise<{
  durationSeconds: number;
  frames: { time: number; path: string }[];
  audioPath: string | null;
  workDir: string;
}> {
  const { ffmpeg, ffprobe } = bin();
  const dir = workDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), "songfit-")));
  await fs.mkdir(dir, { recursive: true });

  const durationSeconds = await probeDuration(ffprobe, videoPath);
  if (durationSeconds > LIMITS.maxDurationSeconds) {
    throw new PipelineError("analyze", `video too long: ${Math.round(durationSeconds)}s > ${LIMITS.maxDurationSeconds}s`);
  }

  const fps = pickFps(durationSeconds, LIMITS.maxFrames);
  const framePattern = path.join(dir, "frame_%03d.jpg");
  await run(ffmpeg, [
    "-hide_banner", "-loglevel", "error",
    "-i", videoPath,
    "-vf", `fps=${fps},scale=${LIMITS.frameWidth}:-2`,
    "-q:v", "4",
    framePattern,
  ]);
  const names = (await fs.readdir(dir)).filter((n) => /^frame_\d{3}\.jpg$/.test(n)).sort();
  const times = frameTimestamps(names.length, fps);
  const frames = names.map((n, i) => ({ time: times[i], path: path.join(dir, n) }));
  if (frames.length === 0) throw new PipelineError("analyze", "no frames extracted");

  let audioPath: string | null = null;
  if (await hasAudioStream(ffprobe, videoPath)) {
    audioPath = path.join(dir, "audio.wav");
    await run(ffmpeg, [
      "-hide_banner", "-loglevel", "error",
      "-i", videoPath,
      "-vn", "-ac", "1", "-ar", "16000", "-f", "wav",
      audioPath,
    ]);
  }

  logger.info("media.extracted", { durationSeconds, frames: frames.length, fps, audio: audioPath !== null });
  return { durationSeconds, frames, audioPath, workDir: dir };
}
```

- [ ] **Step 7: Write the integration test (skips when binaries are missing)**

`tests/media/extract.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const run = promisify(execFile);

let ffmpeg: string | null = null;
try {
  ffmpeg = (await import("ffmpeg-static")).default as string | null;
} catch {
  ffmpeg = null;
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
});
```

- [ ] **Step 8: Run all media tests**

Run: `pnpm vitest run tests/media`
Expected: PASS. If `ffmpeg-static` failed to download its binary, the integration suite reports `skipped`; otherwise 8 tests pass.

Manual check if you want to see the frames: `ls $(node -e "console.log(require('os').tmpdir())")/songfit-*/` after running the test.

- [ ] **Step 9: Typecheck and commit**

```bash
pnpm typecheck && pnpm test
git add package.json pnpm-lock.yaml src/media/extract.ts src/media/extractHelpers.ts tests/media
git commit -m "Add ffmpeg media extraction for frames and audio"
```

---

### Task 2.2: Whisper transcription

**Files:**
- Create: `src/analysis/transcribe.ts`
- Test: `tests/analysis/transcribe.test.ts`

**Interfaces:**
- Consumes: `MODELS.whisper` from config; `env("OPENAI_API_KEY")`.
- Produces:
  ```ts
  export async function transcribe(audioPath: string | null, client?: OpenAI): Promise<string>;
  export function hasDialogue(transcript: string): boolean;
  ```

- [ ] **Step 1: Install the OpenAI SDK**

```bash
pnpm add openai
```

- [ ] **Step 2: Write the failing test**

`tests/analysis/transcribe.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { hasDialogue, transcribe } from "../../src/analysis/transcribe";

describe("hasDialogue", () => {
  it("is false for empty", () => expect(hasDialogue("")).toBe(false));
  it("is false under 5 words", () => expect(hasDialogue("yeah ok so um")).toBe(false));
  it("is true at 5 words", () => expect(hasDialogue("this is my new fit")).toBe(true));
  it("ignores surrounding whitespace", () => expect(hasDialogue("  a b c d e  ")).toBe(true));
});

describe("transcribe", () => {
  it("returns empty string when there is no audio", async () => {
    expect(await transcribe(null)).toBe("");
  });
  it("calls Whisper and trims the result", async () => {
    const create = vi.fn().mockResolvedValue("  hello world  ");
    const client = { audio: { transcriptions: { create } } } as unknown as import("openai").default;
    const text = await transcribe(__filename, client);
    expect(text).toBe("hello world");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "whisper-1", response_format: "text" }),
    );
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

let singleton: OpenAI | null = null;
function defaultClient(): OpenAI {
  if (!singleton) singleton = new OpenAI({ apiKey: env("OPENAI_API_KEY") });
  return singleton;
}

/** Speech only. Returns "" when there is no audio track. */
export async function transcribe(audioPath: string | null, client?: OpenAI): Promise<string> {
  if (!audioPath) return "";
  const c = client ?? defaultClient();
  const result = await c.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: MODELS.whisper,
    response_format: "text",
  });
  const text = String(result).trim();
  logger.info("analysis.transcribed", { chars: text.length });
  return text;
}

export function hasDialogue(transcript: string): boolean {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  return words.length >= 5;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/analysis/transcribe.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
pnpm typecheck && pnpm test
git add package.json pnpm-lock.yaml src/analysis/transcribe.ts tests/analysis/transcribe.test.ts
git commit -m "Add Whisper transcription with dialogue detection"
```

---

### Task 2.3: Claude video analysis → VideoAnalysis + MusicBrief

**Files:**
- Create: `src/analysis/analyzeVideo.ts`
- Create: `src/shared/json.ts`
- Test: `tests/shared/json.test.ts`
- Test: `tests/analysis/analyzeVideo.test.ts`

**Interfaces:**
- Consumes: `VideoAnalysis`, `MusicBrief`, `AnalysisResult` from `src/shared/types.ts`; `MODELS.analysis`, `CONTENT_CATEGORIES`, `env("ANTHROPIC_API_KEY")`; `PipelineError`.
- Produces:
  ```ts
  export const PROMPT_VERSION = "analyze-v1";
  export async function analyzeVideo(
    input: { frames: { time: number; base64: string }[]; transcript: string; creatorIntent: string | null; durationSeconds: number },
    client?: Anthropic,
  ): Promise<AnalysisResult & { raw: string }>;
  // src/shared/json.ts
  export function extractJson(text: string): string;
  ```

- [ ] **Step 1: Install the Anthropic SDK**

```bash
pnpm add @anthropic-ai/sdk
```

- [ ] **Step 2: Write the failing test for extractJson**

`tests/shared/json.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractJson } from "../../src/shared/json";

describe("extractJson", () => {
  it("returns unfenced JSON untouched", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });
  it("strips ```json fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("strips bare ``` fences", () => {
    expect(extractJson('```\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("takes the first { to the last } when there is prose around it", () => {
    expect(extractJson('Here you go:\n{"a":{"b":2}}\nThanks')).toBe('{"a":{"b":2}}');
  });
  it("throws when no object is present", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/shared/json.test.ts`
Expected: FAIL with `Cannot find module '../../src/shared/json'`

- [ ] **Step 4: Implement extractJson**

`src/shared/json.ts`:

```ts
/** Pulls a single JSON object out of model text: strips code fences and surrounding prose. */
export function extractJson(text: string): string {
  let t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("no JSON object found in model output");
  return t.slice(start, end + 1);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/shared/json.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Write the failing tests for analyzeVideo**

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
    create.mockResolvedValueOnce({ content: [{ type: "text", text: r }] });
  }
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const input = {
  frames: [{ time: 0, base64: "AAAA" }, { time: 1, base64: "BBBB" }],
  transcript: "",
  creatorIntent: null,
  durationSeconds: 12,
};

describe("analyzeVideo", () => {
  it("parses a valid response into AnalysisResult", async () => {
    const { client, create } = fakeClient([JSON.stringify(validPayload)]);
    const out = await analyzeVideo(input, client);
    expect(out.analysis.content_category).toBe("fashion");
    expect(out.brief.fields.energy).toBe(0.72);
    expect(out.transcript).toBe("");
    expect(out.prompt_version).toBe(PROMPT_VERSION);
    expect(create).toHaveBeenCalledTimes(1);
    const call = create.mock.calls[0][0];
    expect(call.model).toBeDefined();
    // two image blocks, each preceded by a timestamp label
    const content = call.messages[0].content as { type: string; text?: string }[];
    expect(content.filter((b) => b.type === "image")).toHaveLength(2);
    expect(content.some((b) => b.type === "text" && b.text?.includes("t=1.0s"))).toBe(true);
  });

  it("accepts fenced JSON", async () => {
    const { client } = fakeClient(["```json\n" + JSON.stringify(validPayload) + "\n```"]);
    const out = await analyzeVideo(input, client);
    expect(out.analysis.summary).toContain("NYC");
  });

  it("retries once when the first response fails validation, then succeeds", async () => {
    const bad = JSON.stringify({ analysis: { summary: "x" }, brief: {} });
    const { client, create } = fakeClient([bad, JSON.stringify(validPayload)]);
    const out = await analyzeVideo(input, client);
    expect(out.analysis.content_category).toBe("fashion");
    expect(create).toHaveBeenCalledTimes(2);
    const retryMessages = create.mock.calls[1][0].messages;
    const lastText = JSON.stringify(retryMessages);
    expect(lastText).toContain("did not match the schema");
  });

  it("throws PipelineError with raw text after two invalid responses", async () => {
    const bad = "{\"nope\": true}";
    const { client } = fakeClient([bad, bad]);
    await expect(analyzeVideo(input, client)).rejects.toMatchObject({
      name: "PipelineError",
      stage: "analyze",
      raw: bad,
    });
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `pnpm vitest run tests/analysis/analyzeVideo.test.ts`
Expected: FAIL with `Cannot find module '../../src/analysis/analyzeVideo'`

- [ ] **Step 8: Implement analyzeVideo with the full prompt**

`src/analysis/analyzeVideo.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { MODELS, CONTENT_CATEGORIES, env } from "../shared/config";
import { VideoAnalysis, MusicBrief, type AnalysisResult } from "../shared/types";
import { PipelineError } from "../shared/errors";
import { extractJson } from "../shared/json";
import { logger } from "../shared/logger";

export const PROMPT_VERSION = "analyze-v1";

const ModelOutput = z.object({ analysis: VideoAnalysis, brief: MusicBrief });

let singleton: Anthropic | null = null;
function defaultClient(): Anthropic {
  if (!singleton) singleton = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") });
  return singleton;
}

const SYSTEM_PROMPT = `You are Songfit's video analyst. You watch short-form videos (Reels, TikToks, Shorts) and produce a precise, structured understanding of the content plus a music brief that a music supervisor could act on.

Rules:
- You are given sampled frames labelled with their timestamp (t=Ns), the transcript of any speech, the video duration, and optionally what the creator wants the video to feel like.
- IGNORE any music that may already be in the video. Treat it as silent except for speech. Never mention existing music.
- Describe what actually happens: people, setting, actions, visual aesthetic, story, motion, cuts, pacing, energy, emotional arc.
- important_moments: list the moments a song should react to, each with a timestamp in seconds taken from the frame labels: scene changes, the main visual reveal, a climax, a beat where energy shifts. Use type values like "scene_change", "main_visual_reveal", "climax", "energy_shift", "text_overlay", "ending". Include at most 6.
- content_category must be exactly one of: ${CONTENT_CATEGORIES.join(", ")}.
- energy is one of: low, medium, medium-high, high. pacing is one of: slow, medium, fast.
- dialogue_present is true only if someone speaks words meant to be heard (transcript has real speech).
- The music brief combines WHAT THE VIDEO IS with WHAT THE CREATOR WANTS IT TO BECOME. If the creator gave no intent, infer the most likely intended feel from the content and say in the brief text that it was inferred.
- brief.text is 3–6 sentences in plain language, written for a human music supervisor: the feel, the energy, the cultural register (current vs timeless, mainstream vs niche), vocal considerations given any dialogue, and where in the video a musical lift or hit should land (reference timestamps).
- brief.fields: moods (3–6 words), energy 0..1, tempo_preference (slow | medium | medium-high | high), vocal_preference (vocals | instrumental | either), genre_preferences (may be empty), genre_avoid (may be empty), dialogue_present, desired_cultural_relevance (low | medium | high), desired_familiarity (recognizable | recognizable_not_overused | unexpected).

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
    "important_moments": [{ "time": number, "type": string, "note"?: string }]
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

function buildUserContent(input: {
  frames: { time: number; base64: string }[];
  transcript: string;
  creatorIntent: string | null;
  durationSeconds: number;
}): Block[] {
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
  blocks.push({
    type: "text",
    text: `Transcript of speech (empty means no speech detected):\n"""${input.transcript}"""`,
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

async function callModel(client: Anthropic, content: Block[]): Promise<string> {
  const res = await client.messages.create({
    model: MODELS.analysis,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });
  const text = res.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return text;
}

function tryParse(raw: string): z.infer<typeof ModelOutput> | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(raw));
  } catch (e) {
    return { error: `not valid JSON: ${(e as Error).message}` };
  }
  const parsed = ModelOutput.safeParse(json);
  if (!parsed.success) return { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return parsed.data;
}

export async function analyzeVideo(
  input: { frames: { time: number; base64: string }[]; transcript: string; creatorIntent: string | null; durationSeconds: number },
  client?: Anthropic,
): Promise<AnalysisResult & { raw: string }> {
  const c = client ?? defaultClient();
  const content = buildUserContent(input);

  const first = await callModel(c, content);
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
    raw = await callModel(c, retryContent);
    result = tryParse(raw);
  }

  if ("error" in result) {
    throw new PipelineError("analyze", `model output invalid: ${result.error}`, raw);
  }

  logger.info("analysis.done", { category: result.analysis.content_category, moments: result.analysis.important_moments.length });
  return {
    analysis: result.analysis,
    brief: result.brief,
    transcript: input.transcript,
    prompt_version: PROMPT_VERSION,
    raw,
  };
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `pnpm vitest run tests/analysis/analyzeVideo.test.ts tests/shared/json.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 10: Commit**

```bash
pnpm typecheck && pnpm test
git add package.json pnpm-lock.yaml src/shared/json.ts src/analysis/analyzeVideo.ts tests/shared/json.test.ts tests/analysis/analyzeVideo.test.ts
git commit -m "Add Claude video analysis producing VideoAnalysis and MusicBrief"
```

---

### Task 2.3b: Shared `callClaude` helper

**Files:**
- Create: `src/shared/anthropic.ts`
- Test: `tests/shared/anthropic.test.ts`

**Interfaces:**
- Consumes: `env()` from `src/shared/config.ts`.
- Produces (every Phase 3 stage depends on this exact shape):
  ```ts
  export type ClaudeCall = (args: { model: string; system: string; user: string; maxTokens?: number }) => Promise<string>;
  export const callClaude: ClaudeCall;
  export function makeClaudeCall(client: Pick<Anthropic, "messages">): ClaudeCall; // for tests
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/anthropic.test.ts
import { describe, expect, it, vi } from "vitest";
import { makeClaudeCall } from "../../src/shared/anthropic";

describe("makeClaudeCall", () => {
  it("sends system + user and returns concatenated text blocks", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "hello " }, { type: "text", text: "world" }],
    });
    const call = makeClaudeCall({ messages: { create } } as never);
    const out = await call({ model: "m", system: "S", user: "U", maxTokens: 10 });
    expect(out).toBe("hello world");
    expect(create).toHaveBeenCalledWith({
      model: "m",
      max_tokens: 10,
      system: "S",
      messages: [{ role: "user", content: "U" }],
    });
  });

  it("throws when the response has no text", async () => {
    const create = vi.fn().mockResolvedValue({ content: [] });
    const call = makeClaudeCall({ messages: { create } } as never);
    await expect(call({ model: "m", system: "S", user: "U" })).rejects.toThrow(/no text/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm test -- tests/shared/anthropic.test.ts`
Expected: FAIL, cannot find module `src/shared/anthropic`.

- [ ] **Step 3: Implement**

```ts
// src/shared/anthropic.ts
import Anthropic from "@anthropic-ai/sdk";
import { env } from "./config";

export type ClaudeCall = (args: {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}) => Promise<string>;

/** Builds a text-in / text-out caller around an Anthropic client. Tests inject a stub client. */
export function makeClaudeCall(client: Pick<Anthropic, "messages">): ClaudeCall {
  return async ({ model, system, user, maxTokens = 4000 }) => {
    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text) throw new Error("claude: no text in response");
    return text;
  };
}

let singleton: Anthropic | null = null;
function defaultClient(): Anthropic {
  if (!singleton) singleton = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") });
  return singleton;
}

/** Default caller used in production. Lazily constructs the client so tests never need a key. */
export const callClaude: ClaudeCall = (args) => makeClaudeCall(defaultClient())(args);
```

`analyzeVideo` (Task 2.3) keeps its own client because it sends image blocks; every text-only stage in Phase 3 uses `callClaude`.

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/shared/anthropic.test.ts`
Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/shared/anthropic.ts tests/shared/anthropic.test.ts
git commit -m "Add shared callClaude helper for text-only model stages"
```

---

### Task 2.4: analyzeSubmission orchestration and persistence

**Files:**
- Create: `src/analysis/index.ts`
- Test: `tests/analysis/analyzeSubmission.test.ts`

**Interfaces:**
- Consumes: `getSubmission(id)`, `upsertAnalysis(row)`, `updateSubmission(id, patch)` from `src/db/queries/{submissions,analyses}.ts`; `downloadToTmp(storagePath)` from `src/media/storage.ts`; `extractMedia`; `transcribe`; `analyzeVideo`; `logEvent`.
- Produces: `export async function analyzeSubmission(submissionId: string, deps?: Partial<AnalyzeDeps>): Promise<void>;`

Expected db query shapes (from Phase 1):

```ts
// src/db/queries/analyses.ts
export async function upsertAnalysis(row: {
  submission_id: string; summary: string; content_type: string; setting: string | null; story: string | null;
  aesthetic: string[]; mood: string[]; energy: string; pacing: string; dialogue_present: boolean;
  transcript: string | null; important_moments: unknown; music_brief: string; music_brief_fields: unknown;
  prompt_version: string; raw_response: unknown;
}): Promise<void>;
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
  prompt_version: "analyze-v1",
  raw: "{}",
};

function deps() {
  return {
    getSubmission: vi.fn().mockResolvedValue(submission),
    downloadToTmp: vi.fn().mockResolvedValue("/tmp/x/sub-1.mp4"),
    extractMedia: vi.fn().mockResolvedValue({
      durationSeconds: 12.3,
      frames: [{ time: 0, path: "/tmp/x/frame_001.jpg" }],
      audioPath: "/tmp/x/audio.wav",
      workDir: "/tmp/x",
    }),
    readFrame: vi.fn().mockResolvedValue("QUJD"),
    transcribe: vi.fn().mockResolvedValue(""),
    analyzeVideo: vi.fn().mockResolvedValue(analysisResult),
    upsertAnalysis: vi.fn().mockResolvedValue(undefined),
    updateSubmission: vi.fn().mockResolvedValue(undefined),
    logEvent: vi.fn().mockResolvedValue(undefined),
    removeDir: vi.fn().mockResolvedValue(undefined),
  };
}

describe("analyzeSubmission", () => {
  it("runs the stages in order and persists every column", async () => {
    const d = deps();
    await analyzeSubmission("sub-1", d);

    expect(d.downloadToTmp).toHaveBeenCalledWith("cre-1/sub-1.mp4");
    expect(d.analyzeVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        frames: [{ time: 0, base64: "QUJD" }],
        transcript: "",
        creatorIntent: "make it feel luxurious",
        durationSeconds: 12.3,
      }),
    );
    expect(d.upsertAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        submission_id: "sub-1",
        summary: "s",
        content_type: "fashion reel",
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
        prompt_version: "analyze-v1",
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
    await expect(analyzeSubmission("sub-1", d)).rejects.toThrow("boom");
    expect(d.removeDir).toHaveBeenCalledWith("/tmp/x");
    expect(d.upsertAnalysis).not.toHaveBeenCalled();
  });

  it("throws when the submission does not exist", async () => {
    const d = deps();
    d.getSubmission.mockResolvedValue(null);
    await expect(analyzeSubmission("nope", d)).rejects.toThrow(/not found/);
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

/** Stage 1 of the pipeline: media → transcript → Claude analysis → video_analyses row. Idempotent (upsert). */
export async function analyzeSubmission(submissionId: string, overrides: Partial<AnalyzeDeps> = {}): Promise<void> {
  const d: AnalyzeDeps = { ...defaultDeps, ...overrides };
  const sub = await d.getSubmission(submissionId);
  if (!sub) throw new PipelineError("analyze", `submission not found: ${submissionId}`);

  const videoPath = await d.downloadToTmp(sub.video_path);
  const workDir = path.dirname(videoPath);
  try {
    const media = await d.extractMedia(videoPath, workDir);
    const frames = await Promise.all(
      media.frames.map(async (f) => ({ time: f.time, base64: await d.readFrame(f.path) })),
    );
    const transcript = await d.transcribe(media.audioPath);
    const result = await d.analyzeVideo({
      frames,
      transcript,
      creatorIntent: sub.creator_intent ?? null,
      durationSeconds: media.durationSeconds,
    });

    await d.upsertAnalysis({
      submission_id: submissionId,
      summary: result.analysis.summary,
      content_type: result.analysis.content_type,
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

Note: `downloadToTmp` (Phase 1) must place the file inside its own fresh directory (e.g. `/tmp/songfit-<id>/video.mp4`) so `path.dirname` is safe to delete. If Phase 1 wrote it elsewhere, change `downloadToTmp` to use `fs.mkdtemp` and return the file path inside that directory.

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

### Task 2.5: Pipeline runner with status handling, retry-from-stage and time budget

**Files:**
- Modify: `src/pipeline/run.ts` (replace the Phase 1 stub)
- Create: `src/pipeline/stages.ts`
- Test: `tests/pipeline/stages.test.ts`
- Test: `tests/pipeline/run.test.ts`

**Interfaces:**
- Consumes: `getSubmission`, `setSubmissionStatus(id, status, error?)`, `getAnalysisRow(submissionId)` (returns the raw row or null; Phase 0), `listRecommendations(submissionId)` (returns array; Phase 1 may return `[]`), `analyzeSubmission`, `logEvent`, `LIMITS.pipelineBudgetMs`.
- Produces:
  ```ts
  // src/pipeline/stages.ts
  export type Stage = "analyze" | "recommend" | "done";
  export function nextStage(status: SubmissionStatus, hasAnalysis: boolean, hasRecommendations: boolean): Stage;
  // src/pipeline/run.ts
  export async function runSubmission(submissionId: string, deps?: Partial<RunDeps>): Promise<void>;
  ```
  Phase 3 fills `recommendSubmission` into `RunDeps`; until then it is a stub that throws `PipelineError("recommend", "not implemented")`, which is caught and recorded like any failure.

- [ ] **Step 1: Write the failing test for nextStage**

`tests/pipeline/stages.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextStage } from "../../src/pipeline/stages";

describe("nextStage", () => {
  it("fresh upload → analyze", () => expect(nextStage("uploaded", false, false)).toBe("analyze"));
  it("failed before analysis → analyze", () => expect(nextStage("failed", false, false)).toBe("analyze"));
  it("failed after analysis → recommend (skips analyze)", () => expect(nextStage("failed", true, false)).toBe("recommend"));
  it("analyzing with analysis row present (crashed between) → recommend", () => expect(nextStage("analyzing", true, false)).toBe("recommend"));
  it("recommending → recommend", () => expect(nextStage("recommending", true, false)).toBe("recommend"));
  it("ready with recommendations → done", () => expect(nextStage("ready", true, true)).toBe("done"));
  it("ready but recommendations missing → recommend", () => expect(nextStage("ready", true, false)).toBe("recommend"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/pipeline/stages.test.ts`
Expected: FAIL with `Cannot find module '../../src/pipeline/stages'`

- [ ] **Step 3: Implement nextStage**

`src/pipeline/stages.ts`:

```ts
import type { SubmissionStatus } from "../shared/types";

export type Stage = "analyze" | "recommend" | "done";

/** Which stage to run next, derived from persisted state so retries resume where they failed. */
export function nextStage(status: SubmissionStatus, hasAnalysis: boolean, hasRecommendations: boolean): Stage {
  if (!hasAnalysis) return "analyze";
  if (!hasRecommendations) return "recommend";
  if (status === "ready") return "done";
  return "recommend";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/pipeline/stages.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Write the failing tests for runSubmission**

`tests/pipeline/run.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runSubmission } from "../../src/pipeline/run";
import { PipelineError } from "../../src/shared/errors";

function deps(over: Record<string, unknown> = {}) {
  const state = { status: "uploaded", hasAnalysis: false, hasRecs: false };
  const d = {
    getSubmission: vi.fn(async () => ({ id: "sub-1", creator_id: "cre-1", status: state.status })),
    getAnalysisRow: vi.fn(async () => (state.hasAnalysis ? { id: "an-1" } : null)),
    listRecommendations: vi.fn(async () => (state.hasRecs ? [{ id: "r1" }] : [])),
    setSubmissionStatus: vi.fn(async (_id: string, status: string) => { state.status = status; }),
    analyzeSubmission: vi.fn(async () => { state.hasAnalysis = true; }),
    recommendSubmission: vi.fn(async () => { state.hasRecs = true; }),
    logEvent: vi.fn(async () => undefined),
    now: () => 0,
    ...over,
  };
  return { d, state };
}

describe("runSubmission", () => {
  it("runs analyze then recommend and ends ready", async () => {
    const { d, state } = deps();
    await runSubmission("sub-1", d);
    const statuses = d.setSubmissionStatus.mock.calls.map((c) => c[1]);
    expect(statuses).toEqual(["analyzing", "recommending", "ready"]);
    expect(d.analyzeSubmission).toHaveBeenCalledTimes(1);
    expect(d.recommendSubmission).toHaveBeenCalledTimes(1);
    expect(state.status).toBe("ready");
  });

  it("skips analyze on retry when the analysis row exists", async () => {
    const { d } = deps();
    d.getAnalysisRow.mockResolvedValue({ id: "an-1" });
    d.getSubmission.mockResolvedValue({ id: "sub-1", creator_id: "cre-1", status: "failed" });
    await runSubmission("sub-1", d);
    expect(d.analyzeSubmission).not.toHaveBeenCalled();
    expect(d.recommendSubmission).toHaveBeenCalledTimes(1);
  });

  it("records failure with stage and error and does not throw", async () => {
    const { d } = deps();
    d.analyzeSubmission.mockRejectedValue(new PipelineError("analyze", "video too long"));
    await expect(runSubmission("sub-1", d)).resolves.toBeUndefined();
    expect(d.setSubmissionStatus).toHaveBeenLastCalledWith("sub-1", "failed", "video too long");
    expect(d.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: "pipeline_failed", submissionId: "sub-1", metadata: { stage: "analyze", error: "video too long" } }),
    );
  });

  it("wraps unknown errors with the current stage", async () => {
    const { d } = deps();
    d.recommendSubmission.mockRejectedValue(new Error("deezer down"));
    await runSubmission("sub-1", d);
    expect(d.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { stage: "recommend", error: "deezer down" } }),
    );
  });

  it("fails cleanly when the time budget is exceeded before a stage", async () => {
    let t = 0;
    const { d } = deps({ now: () => t });
    d.analyzeSubmission.mockImplementation(async () => { t = 290_000; });
    await runSubmission("sub-1", d);
    expect(d.recommendSubmission).not.toHaveBeenCalled();
    expect(d.setSubmissionStatus).toHaveBeenLastCalledWith("sub-1", "failed", expect.stringMatching(/budget exceeded/));
  });

  it("does nothing when already done", async () => {
    const { d } = deps();
    d.getSubmission.mockResolvedValue({ id: "sub-1", creator_id: "cre-1", status: "ready" });
    d.getAnalysisRow.mockResolvedValue({ id: "an-1" });
    d.listRecommendations.mockResolvedValue([{ id: "r1" }]);
    await runSubmission("sub-1", d);
    expect(d.setSubmissionStatus).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `pnpm vitest run tests/pipeline/run.test.ts`
Expected: FAIL (the Phase 1 stub does not accept deps / does not call these functions)

- [ ] **Step 7: Implement runSubmission**

`src/pipeline/run.ts`:

```ts
import { getSubmission, setSubmissionStatus } from "../db/queries/submissions";
import { getAnalysisRowRow } from "../db/queries/analyses";
import { listRecommendations } from "../db/queries/recommendations";
import { analyzeSubmission } from "../analysis";
import { logEvent } from "../feedback/events";
import { LIMITS } from "../shared/config";
import { PipelineError } from "../shared/errors";
import { logger } from "../shared/logger";
import { nextStage, type Stage } from "./stages";
import type { SubmissionStatus } from "../shared/types";

export type RunDeps = {
  getSubmission: (id: string) => Promise<{ id: string; creator_id: string; status: string } | null>;
  getAnalysisRow: (submissionId: string) => Promise<unknown | null>;
  listRecommendations: (submissionId: string) => Promise<unknown[]>;
  setSubmissionStatus: (id: string, status: SubmissionStatus, error?: string | null) => Promise<void>;
  analyzeSubmission: (id: string) => Promise<void>;
  recommendSubmission: (id: string) => Promise<void>;
  logEvent: typeof logEvent;
  now: () => number;
};

// Phase 3 replaces this with the real engine orchestrator.
async function recommendSubmissionStub(_id: string): Promise<void> {
  throw new PipelineError("recommend", "not implemented");
}

const defaultDeps: RunDeps = {
  getSubmission,
  getAnalysisRow,
  listRecommendations,
  setSubmissionStatus,
  analyzeSubmission,
  recommendSubmission: recommendSubmissionStub,
  logEvent,
  now: () => Date.now(),
};

const STAGE_STATUS: Record<Exclude<Stage, "done">, SubmissionStatus> = {
  analyze: "analyzing",
  recommend: "recommending",
};

/**
 * Runs the pipeline for one submission from whichever stage is next.
 * Never throws: failures are written to the submission and the events table.
 */
export async function runSubmission(submissionId: string, overrides: Partial<RunDeps> = {}): Promise<void> {
  const d: RunDeps = { ...defaultDeps, ...overrides };
  const started = d.now();

  const sub = await d.getSubmission(submissionId);
  if (!sub) {
    logger.error("pipeline.missing", { submissionId });
    return;
  }

  let stage: Stage = nextStage(
    sub.status as SubmissionStatus,
    (await d.getAnalysisRowRow(submissionId)) !== null,
    (await d.listRecommendations(submissionId)).length > 0,
  );
  let current: Exclude<Stage, "done"> = stage === "done" ? "analyze" : stage;

  try {
    while (stage !== "done") {
      current = stage;
      if (d.now() - started > LIMITS.pipelineBudgetMs) {
        throw new PipelineError(current, `budget exceeded before ${current}`);
      }
      await d.setSubmissionStatus(submissionId, STAGE_STATUS[current], null);
      logger.info("pipeline.stage", { submissionId, stage: current });

      if (current === "analyze") {
        await d.analyzeSubmission(submissionId);
        stage = "recommend";
      } else {
        await d.recommendSubmission(submissionId);
        stage = "done";
        await d.setSubmissionStatus(submissionId, "ready", null);
      }
    }
  } catch (err) {
    const e = err as Error & { stage?: string };
    const failedStage = e instanceof PipelineError ? e.stage : current;
    const message = e.message ?? String(err);
    logger.error("pipeline.failed", { submissionId, stage: failedStage, message });
    await d.setSubmissionStatus(submissionId, "failed", message);
    await d.logEvent({
      name: "pipeline_failed",
      submissionId,
      creatorId: sub.creator_id,
      metadata: { stage: failedStage, error: message },
    });
  }
}
```

`setSubmissionStatus` (Phase 1) must accept a third `error` argument and write it to `submissions.error` (null clears it). If Phase 1's version has only two parameters, add the third now.

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm vitest run tests/pipeline`
Expected: PASS (13 tests)

- [ ] **Step 9: Commit**

```bash
pnpm typecheck && pnpm test
git add src/pipeline/run.ts src/pipeline/stages.ts tests/pipeline
git commit -m "Add pipeline runner with stage resume, failure recording and time budget"
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
- Consumes: `requireAdmin()` from `src/auth/session.ts`; `listSubmissions()` and `getSubmission(id)` from `src/db/queries/submissions.ts`; `getAnalysisRow(submissionId)` from `src/db/queries/analyses.ts`; `getSignedPlaybackUrl(storagePath)` from `src/media/storage.ts`; `runSubmission` from `src/pipeline/run.ts`.
- Produces:
  ```ts
  // src/db/queries/admin.ts
  export function formatElapsed(fromIso: string | null, toIso: string | null): string; // "1m 12s" | "—"
  export function shortId(id: string): string; // first 8 chars
  // app/admin/submissions/[id]/actions.ts
  export async function retrySubmission(formData: FormData): Promise<void>; // server action
  ```

`listSubmissions()` is expected to return rows joined with creator email:

```ts
{ id: string; status: string; created_at: string; analyzed_at: string | null; recommended_at: string | null;
  content_category: string | null; error: string | null; creator: { email: string } | null }[]
```

Phase 0's `listSubmissions` already returns `SubmissionWithCreator[]` with `creator.email`.

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
import { listSubmissions } from "@/src/db/queries/submissions";
import { formatElapsed, shortId } from "@/src/db/queries/admin";

export const dynamic = "force-dynamic";

export default async function AdminQueuePage() {
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

      {sub.error && <p className="rounded bg-red-50 p-3 text-sm text-red-800">Error: {sub.error}</p>}

      <section className="grid gap-6 md:grid-cols-[320px_1fr]">
        <video controls playsInline className="w-full rounded bg-black" src={videoUrl} />
        <dl className="text-sm">
          <Row label="Creator intent" value={sub.creator_intent ?? "—"} />
          <Row label="Duration" value={sub.duration_seconds ? `${sub.duration_seconds.toFixed(1)}s` : "—"} />
          <Row label="Category" value={sub.content_category ?? "—"} />
          <Row label="Created" value={new Date(sub.created_at).toLocaleString()} />
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
              <Row label="Setting" value={analysis.setting ?? "—"} />
              <Row label="Story" value={analysis.story ?? "—"} />
              <Row label="Aesthetic" value={analysis.aesthetic.join(", ")} />
              <Row label="Mood" value={analysis.mood.join(", ")} />
              <Row label="Energy / pacing" value={`${analysis.energy} / ${analysis.pacing}`} />
              <Row label="Dialogue" value={analysis.dialogue_present ? "yes" : "no"} />
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
              <h3 className="font-medium">Transcript</h3>
              <p className="whitespace-pre-wrap rounded bg-neutral-50 p-3">{analysis.transcript || "(no speech)"}</p>
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

`getAnalysis` must return the row with `aesthetic`, `mood` as `string[]`, `important_moments` and `music_brief_fields` as parsed JSON (Supabase returns jsonb as objects already). If Phase 1 typed these columns as `unknown`, cast at the query boundary in `src/db/queries/analyses.ts`, not in the page.

- [ ] **Step 9: Typecheck, run dev, and check the pages**

```bash
pnpm typecheck && pnpm test && pnpm dev
```

Open `http://localhost:3000/admin` signed in as the `ADMIN_EMAILS` account. Expected: the table lists submissions. Open a submission: the video plays, "No analysis yet." shows until the pipeline has run. Signed in as a non-admin: redirected or 403 per `requireAdmin()`.

- [ ] **Step 10: Commit**

```bash
git add app/admin src/db/queries/admin.ts tests/db/adminFormat.test.ts
git commit -m "Add admin queue and submission inspector with analysis view"
```

---

### Phase 2 demo check

1. `pnpm dev`, upload a real ~30 s Reel from the phone flow built in Phase 1.
2. Watch `/admin`: status goes `uploaded → analyzing → recommending`, then `failed` with error `not implemented` (the Phase 3 stub). That failure is expected and proves the runner records failures.
3. Open the inspector. Expected: the video plays; summary, category, moods and energy match what you see; `important_moments` timestamps line up with real cuts or the reveal; the brief reads like something a music supervisor could act on and mentions where the lift should land; the transcript is empty for a music-only Reel and populated for a talking one.
4. Click "Retry pipeline". Expected: `analyzeSubmission` is skipped (status jumps to `recommending`, then `failed` again) — confirms resume-from-stage.
5. Note the cost per run in the Anthropic console (expect roughly $0.05–0.15 for 60 frames at 512 px) and the OpenAI console (Whisper, under $0.01 for 30 s). Write both numbers into `docs/RESEARCH.md` under a new dated entry.
