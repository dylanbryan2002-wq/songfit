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
  prompt_version: "analyze-v3",
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
    transcodeForPlayback: vi.fn().mockResolvedValue("/tmp/x/playback.mp4"),
    uploadPlayback: vi.fn().mockResolvedValue(undefined),
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
        creatorVibe: { tags: [], note: "make it feel luxurious" },
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
        prompt_version: "analyze-v3",
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

  it("passes tags and the creator_intent note as the vibe; null when the row has neither", async () => {
    const v = deps();
    v.getSubmission.mockResolvedValue({ ...submission, vibe_tags: ["Funny", "Travel"], creator_intent: " the song is the punchline " });
    await analyzeSubmission("sub-1", ctx, v);
    expect(v.analyzeVideo).toHaveBeenCalledWith(
      expect.objectContaining({ creatorVibe: { tags: ["Funny", "Travel"], note: "the song is the punchline" } }),
      ctx,
    );

    const none = deps();
    none.getSubmission.mockResolvedValue({ ...submission, creator_intent: null });
    await analyzeSubmission("sub-1", ctx, none);
    expect(none.analyzeVideo).toHaveBeenCalledWith(expect.objectContaining({ creatorVibe: null }), ctx);

    const tagsOnly = deps();
    tagsOnly.getSubmission.mockResolvedValue({ ...submission, vibe_tags: ["Deep"], creator_intent: "  " });
    await analyzeSubmission("sub-1", ctx, tagsOnly);
    expect(tagsOnly.analyzeVideo).toHaveBeenCalledWith(expect.objectContaining({ creatorVibe: { tags: ["Deep"], note: null } }), ctx);
  });

  it("cleans up the work dir even when analysis throws", async () => {
    const d = deps();
    d.analyzeVideo.mockRejectedValue(new Error("boom"));
    await expect(analyzeSubmission("sub-1", ctx, d)).rejects.toThrow("boom");
    expect(d.removeDir).toHaveBeenCalledWith("/tmp/x");
    expect(d.upsertAnalysis).not.toHaveBeenCalled();
  });

  it("skips transcription when the video has no audio track", async () => {
    const d = deps();
    d.extractMedia.mockResolvedValue({ durationSeconds: 5, frames: [], audioPath: null, workDir: "/tmp/x" });
    await analyzeSubmission("sub-1", ctx, d);
    expect(d.transcribe).not.toHaveBeenCalled();
    expect(d.analyzeVideo).toHaveBeenCalledWith(expect.objectContaining({ transcript: "", transcriptSegments: [] }), ctx);
  });

  it("starts the transcode before Whisper, and uploads + records playback_path after the analysis is persisted", async () => {
    const d = deps();
    await analyzeSubmission("sub-1", ctx, d);
    expect(d.transcodeForPlayback).toHaveBeenCalledWith("/tmp/x/video.mp4", "/tmp/x", 1_000_000);
    expect(d.uploadPlayback).toHaveBeenCalledWith("cre-1/sub-1.playback.mp4", "/tmp/x/playback.mp4");
    expect(d.updateSubmission).toHaveBeenCalledWith("sub-1", { playback_path: "cre-1/sub-1.playback.mp4" });
    const order = (f: { mock: { invocationCallOrder: number[] } }) => f.mock.invocationCallOrder[0]!;
    expect(order(d.transcodeForPlayback)).toBeLessThan(order(d.transcribe));
    expect(order(d.upsertAnalysis)).toBeLessThan(order(d.uploadPlayback));
  });

  it("runs Whisper and the model call while the transcode is still running", async () => {
    const d = deps();
    let finish: (v: string | null) => void = () => undefined;
    d.transcodeForPlayback.mockReturnValue(new Promise((r) => { finish = r; }));
    const run = analyzeSubmission("sub-1", ctx, d);
    await vi.waitFor(() => expect(d.upsertAnalysis).toHaveBeenCalled());
    expect(d.uploadPlayback).not.toHaveBeenCalled();
    finish("/tmp/x/playback.mp4");
    await run;
    expect(d.uploadPlayback).toHaveBeenCalled();
  });

  it("does not fail the stage when the transcode promise rejects", async () => {
    const d = deps();
    d.transcodeForPlayback.mockRejectedValue(new Error("ffmpeg gone"));
    await analyzeSubmission("sub-1", ctx, d);
    expect(d.uploadPlayback).not.toHaveBeenCalled();
    expect(d.logEvent).toHaveBeenCalledWith(expect.objectContaining({ name: "analysis_completed" }));
  });

  it("continues without a playback copy when the transcode returns null", async () => {
    const d = deps();
    d.transcodeForPlayback.mockResolvedValue(null);
    await analyzeSubmission("sub-1", ctx, d);
    expect(d.uploadPlayback).not.toHaveBeenCalled();
    expect(d.updateSubmission).not.toHaveBeenCalledWith("sub-1", expect.objectContaining({ playback_path: expect.anything() }));
    expect(d.upsertAnalysis).toHaveBeenCalled();
  });

  it("does not fail the stage when the playback upload throws", async () => {
    const d = deps();
    d.uploadPlayback.mockRejectedValue(new Error("storage down"));
    await analyzeSubmission("sub-1", ctx, d);
    expect(d.upsertAnalysis).toHaveBeenCalled();
    expect(d.logEvent).toHaveBeenCalledWith(expect.objectContaining({ name: "analysis_completed" }));
  });

  it("throws when the submission does not exist", async () => {
    const d = deps();
    d.getSubmission.mockResolvedValue(null);
    await expect(analyzeSubmission("nope", ctx, d)).rejects.toThrow(/not found/);
  });
});

describe("analyzeSubmission with the new engine on (Dylan, 2026-10-11)", () => {
  it("also measures pacing and stores the video profile; the old engine does neither", async () => {
    const profile = { reading: { content_type: "Vlog" }, pacing: { energy: 0.4 }, energy: 0.4, mood: 0.6, raw: "{}" };
    const heard = { transcript: { text: "hey", segments: [{ start: 0, end: 1, text: "hey" }] }, voice: { energy: 0.8, mood: 0.7 }, wordsPerSecond: 3, laughter: false, sarcasm: false, raw: "{}" };
    const d = { ...deps(), engine: "new" as const, measurePacing: vi.fn().mockResolvedValue({ cutsPerMinute: 10, medianShot: 3, motionPeak: 0.05, energy: 0.4 }), buildVideoProfile: vi.fn().mockResolvedValue(profile), listenWithGemini: vi.fn().mockResolvedValue(heard), readFaces: vi.fn().mockResolvedValue({ mood: 0.6, energy: 0.5, faceFrames: 8, frames: 10 }) };
    await analyzeSubmission("sub-1", ctx, d as never);
    expect(d.measurePacing).toHaveBeenCalledWith("/tmp/x/video.mp4");
    // Audio is Gemini on the new engine (Dylan): Whisper is not called, Gemini's words and voice are used.
    expect(d.transcribe).not.toHaveBeenCalled();
    expect(d.listenWithGemini).toHaveBeenCalledWith("/tmp/x/audio.wav", { deadlineAt: 1_000_000 });
    expect(d.analyzeVideo.mock.calls[0]![0].transcript).toBe("hey");
    expect(d.buildVideoProfile.mock.calls[0]![2]).toMatchObject({ voice: { energy: 0.8, mood: 0.7 }, faces: { mood: 0.6, energy: 0.5 } });
    expect(d.readFaces).toHaveBeenCalledWith("/tmp/x/video.mp4", 12.3);
    const row = d.upsertAnalysis.mock.calls[0]![0];
    expect(row.video_profile).toEqual({ reading: profile.reading, pacing: profile.pacing, voice: { energy: 0.8, mood: 0.7, words_per_second: 3, laughter: false, sarcasm: false }, faces: { mood: 0.6, energy: 0.5, faceFrames: 8, frames: 10 }, energy: 0.4, mood: 0.6 });
    expect(row.pacing).toEqual({ cutsPerMinute: 10, medianShot: 3, motionPeak: 0.05, energy: 0.4 });
    expect(row.profile_prompt_version).toMatch(/^profile-v/);

    const old = { ...deps(), engine: "old" as const, measurePacing: vi.fn(), buildVideoProfile: vi.fn(), listenWithGemini: vi.fn(), readFaces: vi.fn() };
    await analyzeSubmission("sub-1", ctx, old as never);
    expect(old.measurePacing).not.toHaveBeenCalled();
    expect(old.listenWithGemini).not.toHaveBeenCalled();
    expect(old.readFaces).not.toHaveBeenCalled();
    expect(old.upsertAnalysis.mock.calls[0]![0].video_profile).toBeUndefined();
  });
});
