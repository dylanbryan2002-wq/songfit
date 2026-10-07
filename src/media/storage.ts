import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServiceClient } from "@/src/db/client";

export const VIDEO_BUCKET = "videos";

export function storagePathFor(creatorId: string, submissionId: string, ext: string): string {
  return `${creatorId}/${submissionId}.${ext}`;
}

/** Exact string equality against the server-built path. No prefix logic, no normalisation. */
export function isExactStoragePath(candidate: string, creatorId: string, submissionId: string, ext: string): boolean {
  return candidate === storagePathFor(creatorId, submissionId, ext);
}

export async function getSignedUploadUrl(
  creatorId: string,
  submissionId: string,
  ext: string,
): Promise<{ path: string; token: string; signedUrl: string }> {
  const supabase = createServiceClient();
  const objectPath = storagePathFor(creatorId, submissionId, ext);
  const { data, error } = await supabase.storage
    .from(VIDEO_BUCKET)
    .createSignedUploadUrl(objectPath);
  if (error || !data) throw new Error(`createSignedUploadUrl failed: ${error?.message}`);
  return { path: data.path, token: data.token, signedUrl: data.signedUrl };
}

/** Size and type of a stored object, or null when it doesn't exist. */
export async function objectInfo(
  storagePath: string,
): Promise<{ sizeBytes: number; mimeType: string | null } | null> {
  const supabase = createServiceClient();
  const dir = path.posix.dirname(storagePath);
  const name = path.posix.basename(storagePath);
  const { data, error } = await supabase.storage.from(VIDEO_BUCKET).list(dir, { search: name });
  if (error) throw new Error(`storage list failed: ${error.message}`);
  const obj = (data ?? []).find((o) => o.name === name);
  if (!obj) return null;
  const meta = (obj.metadata ?? {}) as { size?: number; mimetype?: string };
  return { sizeBytes: Number(meta.size ?? 0), mimeType: meta.mimetype ?? null };
}

/**
 * Downloads the object into a fresh private directory (`/tmp/songfit-<random>/video.<ext>`)
 * so callers can `rm -rf path.dirname(result)` safely when done (Phase 2 relies on this).
 */
export async function downloadToTmp(storagePath: string): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage.from(VIDEO_BUCKET).download(storagePath);
  if (error || !data) throw new Error(`storage download failed: ${error?.message}`);
  const dir = await mkdtemp(path.join(os.tmpdir(), "songfit-"));
  const ext = path.posix.extname(storagePath) || ".mp4";
  const localPath = path.join(dir, `video${ext}`);
  await writeFile(localPath, Buffer.from(await data.arrayBuffer()));
  return localPath;
}

export async function getSignedPlaybackUrl(storagePath: string, seconds = 3600): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(VIDEO_BUCKET)
    .createSignedUrl(storagePath, seconds);
  if (error || !data) throw new Error(`createSignedUrl failed: ${error?.message}`);
  return data.signedUrl;
}
