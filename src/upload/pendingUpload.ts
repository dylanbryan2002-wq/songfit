import { z } from "zod";

/**
 * Keeps the video a signed-out creator chose on THIS device (IndexedDB) across the Google
 * round-trip, so it can be uploaded after sign-in. Nothing here talks to our servers.
 * Every call is bounded by STORAGE_TIMEOUT_MS and rejects on any failure; callers fall back to
 * sign-in-first. A record is only ever deleted when it is the caller's own flowId, or when it is
 * expired or malformed (useless to every flow). A fresh record of another flow is never touched.
 */

export const PENDING_MAX_AGE_MS = 30 * 60_000;
export const STORAGE_TIMEOUT_MS = 5_000;
/** sessionStorage key holding this tab's landing flowId. */
export const FLOW_ID_KEY = "songfit.flowId";

const DB = "songfit";
const STORE = "pending";

const PendingRecord = z.object({
  flowId: z.string().uuid(),
  blob: z.instanceof(Blob),
  name: z.string(),
  type: z.string(),
  size: z.number().int().nonnegative(),
  durationSeconds: z.number().nonnegative().nullable(),
  savedAt: z.number(),
});
type PendingRecord = z.infer<typeof PendingRecord>;

export type PendingUpload = { flowId: string; file: File; durationSeconds: number | null };

function isFresh(savedAt: number, now: number): boolean {
  const age = now - savedAt;
  return age >= 0 && age < PENDING_MAX_AGE_MS;
}

/** Valid, fresh, and stored under its own flowId. */
function usable(key: IDBValidKey, value: unknown, now: number): PendingRecord | null {
  const parsed = PendingRecord.safeParse(value);
  if (!parsed.success || parsed.data.flowId !== key || !isFresh(parsed.data.savedAt, now)) return null;
  return parsed.data;
}

function withTimeout<T>(work: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("pending_upload_timeout")), STORAGE_TIMEOUT_MS);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const factory = globalThis.indexedDB;
    if (!factory) throw new Error("indexeddb_unavailable");
    const req = factory.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexeddb_open_failed"));
    req.onblocked = () => reject(new Error("indexeddb_blocked"));
  });
}

/** Runs `fn` in one transaction and resolves with its result only after the transaction COMMITS. */
async function inTransaction<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => () => T): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result());
      tx.onerror = () => reject(tx.error ?? new Error("indexeddb_tx_failed"));
      tx.onabort = () => reject(tx.error ?? new Error("indexeddb_tx_aborted"));
    });
  } finally {
    db.close();
  }
}

/** Deletes every expired or malformed record the cursor meets; fresh records of any flow stay. */
function sweep(store: IDBObjectStore, now: number, onRecord?: (key: IDBValidKey, rec: PendingRecord) => void) {
  const cursorReq = store.openCursor();
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (!cursor) return;
    const rec = usable(cursor.key, cursor.value, now);
    if (rec) onRecord?.(cursor.key, rec);
    else cursor.delete();
    cursor.continue();
  };
}

/** Stores the file and resolves with its flowId once the write has committed. */
export function stashPendingUpload(
  file: File,
  meta: { flowId?: string; durationSeconds: number | null },
): Promise<string> {
  const flowId = meta.flowId ?? crypto.randomUUID();
  const now = Date.now();
  const record: PendingRecord = {
    flowId,
    blob: file,
    name: file.name,
    type: file.type,
    size: file.size,
    durationSeconds: meta.durationSeconds,
    savedAt: now,
  };
  return withTimeout(
    inTransaction("readwrite", (store) => {
      sweep(store, now);
      store.put(record, flowId);
      return () => flowId;
    }),
  );
}

/** The fresh record for exactly this flowId, else null. Expired/malformed records it meets are deleted. */
export function readPendingUpload(flowId: string, now = Date.now()): Promise<PendingUpload | null> {
  return withTimeout(
    inTransaction("readwrite", (store) => {
      let found: PendingRecord | null = null;
      sweep(store, now, (key, rec) => {
        if (key === flowId) found = rec;
      });
      return () => {
        const rec = found as PendingRecord | null;
        if (!rec) return null;
        const file = rec.blob instanceof File ? rec.blob : new File([rec.blob], rec.name, { type: rec.type });
        return { flowId: rec.flowId, file, durationSeconds: rec.durationSeconds };
      };
    }),
  );
}

export function clearPendingUpload(flowId: string): Promise<void> {
  return withTimeout(
    inTransaction("readwrite", (store) => {
      store.delete(flowId);
      return () => undefined;
    }),
  );
}
