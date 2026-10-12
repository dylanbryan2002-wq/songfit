import { describe, it, expect } from "vitest";
import { decodeYunet, cropToTensor, summarizeFaces, sampleFps, SIZE } from "../../src/media/faces";

function emptyOutputs() {
  const o: Record<string, { data: Float32Array }> = {};
  for (const s of [8, 16, 32]) {
    const n = (SIZE / s) ** 2;
    o[`cls_${s}`] = { data: new Float32Array(n) };
    o[`obj_${s}`] = { data: new Float32Array(n) };
    o[`bbox_${s}`] = { data: new Float32Array(n * 4) };
  }
  return o;
}

describe("faces (new engine v1, Dylan 2026-10-11): YuNet finds faces, HSEmotion reads them", () => {
  it("decodes the strongest face box from the detector's grid", () => {
    const o = emptyOutputs();
    const cols = SIZE / 32, i = 3 * cols + 5; // row 3, col 5 on the stride-32 grid
    o.cls_32!.data[i] = 0.9; o.obj_32!.data[i] = 0.9;
    o.bbox_32!.data.set([0.5, 0.5, Math.log(4), Math.log(5)], i * 4);
    const [box] = decodeYunet(o as never, 0.6);
    expect(box!.score).toBeCloseTo(0.9, 5);
    expect(box!.w).toBeCloseTo(128, 3);
    expect(box!.h).toBeCloseTo(160, 3);
    expect(box!.x + box!.w / 2).toBeCloseTo((5 + 0.5) * 32, 3);
  });

  it("ignores weak detections", () => {
    const o = emptyOutputs();
    o.cls_8!.data[0] = 0.3; o.obj_8!.data[0] = 0.3;
    expect(decodeYunet(o as never, 0.6)).toEqual([]);
  });

  it("crops a face to a 224x224 normalised RGB tensor", () => {
    const frame = Buffer.alloc(SIZE * SIZE * 3, 128);
    const t = cropToTensor(frame, { x: 100, y: 100, w: 200, h: 200, score: 1 });
    expect(t.length).toBe(3 * 224 * 224);
  });

  it("turns valence/arousal (-1..1) into mood/energy (0..1); too few faces means no reading", () => {
    const frames = [{ valence: 0.6, arousal: -0.2 }, { valence: 0.2, arousal: 0.2 }, null, null];
    const r = summarizeFaces(frames);
    expect(r).toEqual({ mood: 0.7, energy: 0.5, faceFrames: 2, frames: 4 });
    expect(summarizeFaces([null, null, null, null, null, { valence: 0, arousal: 0 }])).toBeNull();
  });

  it("samples at most 20 frames spread across the video", () => {
    expect(sampleFps(60)).toBeCloseTo(20 / 60, 5);
    expect(sampleFps(10)).toBe(1); // short video: 1 per second
  });
});
