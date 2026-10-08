import { describe, expect, it } from "vitest";
import { ensureMix, loopLength, needsNudge, playFailure, videoTimeFor } from "@/components/picker/useSyncedPlayback";

describe("loopLength", () => {
  it("is the min of the two durations", () => {
    expect(loopLength(4.5, 30)).toBe(4.5);
    expect(loopLength(60, 29.8)).toBe(29.8);
  });
  it("subtracts the sample start from the preview", () => {
    expect(loopLength(20, 30, 15)).toBe(15);
    expect(loopLength(5, 30, 10)).toBe(5);
  });
  it("is null when under 0.5 s remain", () => {
    expect(loopLength(5, 30, 29.9)).toBeNull();
    expect(loopLength(5, 30, 31)).toBeNull();
  });
  it("is null when either is unknown or not positive", () => {
    expect(loopLength(null, 30)).toBeNull();
    expect(loopLength(10, null)).toBeNull();
    expect(loopLength(0, 30)).toBeNull();
    expect(loopLength(10, -1)).toBeNull();
    expect(loopLength(10, Number.NaN)).toBeNull();
  });
});

describe("videoTimeFor", () => {
  it("is audio time minus sample start", () => {
    expect(videoTimeFor(7, 5, 10)).toBeCloseTo(2);
  });
  it("wraps into [0, loop)", () => {
    expect(videoTimeFor(16, 5, 4.5)).toBeCloseTo(2);
    expect(videoTimeFor(9.5, 5, 4.5)).toBeCloseTo(0);
  });
  it("wraps negatives up", () => {
    expect(videoTimeFor(4, 5, 4.5)).toBeCloseTo(3.5);
  });
});

describe("needsNudge", () => {
  it("is false within the threshold and true beyond it, both directions", () => {
    expect(needsNudge(1.0, 1.1)).toBe(false);
    expect(needsNudge(1.1, 1.0)).toBe(false);
    expect(needsNudge(1.0, 1.2)).toBe(true);
    expect(needsNudge(1.2, 1.0)).toBe(true);
  });
  it("honours a custom threshold", () => {
    expect(needsNudge(1, 1.3, 0.5)).toBe(false);
    expect(needsNudge(1, 1.6, 0.5)).toBe(true);
  });
});

describe("playFailure", () => {
  it("ignores an AbortError from either element (a newer tap superseded it)", () => {
    expect(playFailure("audio", "AbortError")).toBe("ignore");
    expect(playFailure("video", "AbortError")).toBe("ignore");
  });
  it("keeps audio going when only the video cannot play", () => {
    expect(playFailure("video", "NotSupportedError")).toBe("audio_only");
    expect(playFailure("video", "NotAllowedError")).toBe("audio_only");
  });
  it("is unavailable only when the audio fails", () => {
    expect(playFailure("audio", "NotSupportedError")).toBe("unavailable");
    expect(playFailure("audio", "unknown")).toBe("unavailable");
  });
});

// A minimal Web Audio stand-in: records the graph, never makes sound.
class FakeNode {
  out: unknown[] = [];
  connect(n: unknown) {
    this.out.push(n);
    return n;
  }
}
class FakeGain extends FakeNode {
  gain = { value: 1 };
}
class FakeContext {
  state: "suspended" | "running" = "suspended";
  destination = new FakeNode();
  resumed = 0;
  sources = new Map<unknown, FakeNode>();
  failFor = new Set<unknown>();
  resume() {
    this.resumed++;
    this.state = "running";
    return Promise.resolve();
  }
  createGain() {
    return new FakeGain();
  }
  createMediaElementSource(el: unknown) {
    if (this.failFor.has(el) || this.sources.has(el)) throw new Error("InvalidStateError");
    const n = new FakeNode();
    this.sources.set(el, n);
    return n;
  }
}
const asCtx = (c: FakeContext) => c as unknown as AudioContext;
const video = {} as HTMLVideoElement;
const audio = {} as HTMLAudioElement;

describe("ensureMix", () => {
  it("routes video → voice gain and audio → music gain, and resumes inside the tap", () => {
    const ctx = new FakeContext();
    const m = ensureMix(null, video, audio, () => asCtx(ctx));
    expect(m).not.toBeNull();
    expect(ctx.resumed).toBe(1);
    expect(ctx.sources.get(video)?.out).toEqual([m!.voice]);
    expect(ctx.sources.get(audio)?.out).toEqual([m!.music]);
    expect((m!.voice as unknown as FakeGain).out).toEqual([ctx.destination]);
    expect((m!.music as unknown as FakeGain).out).toEqual([ctx.destination]);
  });
  it("attaches each element once and reuses the graph on later taps", () => {
    const ctx = new FakeContext();
    let made = 0;
    const create = () => (made++, asCtx(ctx));
    const m1 = ensureMix(null, video, audio, create);
    ctx.state = "suspended";
    const m2 = ensureMix(m1, video, audio, create);
    expect(m2).toBe(m1);
    expect(made).toBe(1);
    expect(ctx.sources.size).toBe(2);
    expect(ctx.resumed).toBe(2);
  });
  it("is null when there is no Web Audio (old browser)", () => {
    expect(ensureMix(null, video, audio, () => null)).toBeNull();
    expect(
      ensureMix(null, video, audio, () => {
        throw new Error("no");
      }),
    ).toBeNull();
  });
  it("leaves the voice out when the video cannot be attached, keeping music", () => {
    const ctx = new FakeContext();
    ctx.failFor.add(video);
    const m = ensureMix(null, video, audio, () => asCtx(ctx));
    expect(m?.voice).toBeNull();
    expect(m?.music).not.toBeNull();
  });
});
