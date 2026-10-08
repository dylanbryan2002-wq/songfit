import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  stashPendingUpload,
  readPendingUpload,
  clearPendingUpload,
  PENDING_MAX_AGE_MS,
  STORAGE_TIMEOUT_MS,
} from "@/src/upload/pendingUpload";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const clip = () => new File([new Uint8Array([1, 2, 3, 4])], "clip.mov", { type: "video/quicktime" });

/** Raw access to the same store, to plant and inspect records. */
function raw<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("songfit", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("pending");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction("pending", mode);
      const req = fn(tx.objectStore("pending"));
      tx.oncomplete = () => {
        open.result.close();
        resolve(req.result);
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}
const keys = () => raw("readonly", (s) => s.getAllKeys());

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("pendingUpload", () => {
  it("stash → read → clear round-trips the file under its flowId", async () => {
    const id = await stashPendingUpload(clip(), { flowId: A, durationSeconds: 14.2 });
    expect(id).toBe(A);
    const got = await readPendingUpload(A);
    expect(got).not.toBeNull();
    expect(got!.flowId).toBe(A);
    expect(got!.durationSeconds).toBe(14.2);
    expect(got!.file.name).toBe("clip.mov");
    expect(got!.file.type).toBe("video/quicktime");
    expect(got!.file.size).toBe(4);
    expect(new Uint8Array(await got!.file.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    await clearPendingUpload(A);
    expect(await readPendingUpload(A)).toBeNull();
    expect(await keys()).toEqual([]);
  });

  it("generates a UUID flowId when none is given, and keeps a null duration", async () => {
    const id = await stashPendingUpload(clip(), { durationSeconds: null });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await readPendingUpload(id))!.durationSeconds).toBeNull();
  });

  it("round-trips the vibe tags and note, and reads them as skipped when not given", async () => {
    await stashPendingUpload(clip(), {
      flowId: A,
      durationSeconds: 9,
      vibeTags: ["Funny", "Day in the Life"],
      vibeNote: "the song is the punchline",
    });
    const got = await readPendingUpload(A);
    expect(got!.vibeTags).toEqual(["Funny", "Day in the Life"]);
    expect(got!.vibeNote).toBe("the song is the punchline");

    await stashPendingUpload(clip(), { flowId: B, durationSeconds: 9 });
    const plain = await readPendingUpload(B);
    expect(plain!.vibeTags).toEqual([]);
    expect(plain!.vibeNote).toBe("");
  });

  it("reads a record stashed before vibe fields existed as skipped", async () => {
    const old = { flowId: A, blob: clip(), name: "clip.mov", type: "video/quicktime", size: 4, durationSeconds: 3, savedAt: Date.now() };
    await raw("readwrite", (s) => s.put(old, A));
    const got = await readPendingUpload(A);
    expect(got!.vibeTags).toEqual([]);
    expect(got!.vibeNote).toBe("");
  });

  it("returns null for a missing id", async () => {
    expect(await readPendingUpload(B)).toBeNull();
  });

  it("returns null and deletes an expired record", async () => {
    const now = Date.now();
    await stashPendingUpload(clip(), { flowId: A, durationSeconds: 3 });
    expect(await readPendingUpload(A, now + PENDING_MAX_AGE_MS + 1)).toBeNull();
    expect(await keys()).toEqual([]);
  });

  it("treats a savedAt in the future as not fresh", async () => {
    await stashPendingUpload(clip(), { flowId: A, durationSeconds: 3 });
    expect(await readPendingUpload(A, Date.now() - 60_000)).toBeNull();
  });

  it("never deletes a fresh record with a different flowId", async () => {
    await stashPendingUpload(clip(), { flowId: A, durationSeconds: 3 });
    await stashPendingUpload(clip(), { flowId: B, durationSeconds: 3 });
    expect(await readPendingUpload(A)).not.toBeNull();
    await clearPendingUpload(A);
    expect(await keys()).toEqual([B]);
    expect(await readPendingUpload(B)).not.toBeNull();
  });

  it("sweeps expired records of other flows it meets, keeps fresh ones", async () => {
    await raw("readwrite", (s) =>
      s.put({ flowId: B, blob: clip(), name: "old.mov", type: "video/quicktime", size: 4, durationSeconds: null, savedAt: Date.now() - PENDING_MAX_AGE_MS - 5 }, B),
    );
    await stashPendingUpload(clip(), { flowId: A, durationSeconds: 3 });
    expect(await keys()).toEqual([A]);
  });

  it("rejects and deletes a malformed record or one stored under another key", async () => {
    await raw("readwrite", (s) => s.put({ flowId: A, name: "x" }, A));
    expect(await readPendingUpload(A)).toBeNull();
    expect(await keys()).toEqual([]);

    await raw("readwrite", (s) =>
      s.put({ flowId: B, blob: clip(), name: "c.mov", type: "video/quicktime", size: 4, durationSeconds: null, savedAt: Date.now() }, A),
    );
    expect(await readPendingUpload(A)).toBeNull();
    expect(await keys()).toEqual([]);
  });

  it("rejects within the timeout when IndexedDB never answers", async () => {
    vi.useFakeTimers();
    globalThis.indexedDB = { open: () => ({}) } as unknown as IDBFactory;
    const stash = stashPendingUpload(clip(), { flowId: A, durationSeconds: 3 });
    const read = readPendingUpload(A);
    const clear = clearPendingUpload(A);
    const all = Promise.allSettled([stash, read, clear]);
    await vi.advanceTimersByTimeAsync(STORAGE_TIMEOUT_MS + 1);
    const results = await all;
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected", "rejected"]);
  });

  it("rejects when IndexedDB is missing", async () => {
    // @ts-expect-error simulate a browser without IndexedDB
    delete globalThis.indexedDB;
    await expect(stashPendingUpload(clip(), { flowId: A, durationSeconds: 3 })).rejects.toThrow();
  });
});
