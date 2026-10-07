"use client";
import * as tus from "tus-js-client";
import { createBrowserClient } from "@/src/db/browser";

const SIX_MB = 6 * 1024 * 1024;

export async function uploadVideo(args: {
  file: File;
  path: string;
  token: string;
  signedUrl: string;
  onProgress: (pct: number) => void;
}): Promise<void> {
  if (args.file.size <= SIX_MB) return putToSignedUrl(args.signedUrl, args.file, args.onProgress);
  return resumableUpload(args.file, args.path, args.onProgress);
}

/** Small files: one PUT to the signed upload URL (token is in the URL). */
function putToSignedUrl(signedUrl: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl, true);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload_${xhr.status}`)));
    xhr.onerror = () => reject(new Error("upload_network"));
    xhr.onabort = () => reject(new Error("upload_aborted"));
    xhr.send(file);
  });
}

/** Big files: TUS resumable upload with automatic retry, survives flaky cellular. */
async function resumableUpload(file: File, objectName: string, onProgress: (pct: number) => void): Promise<void> {
  const supabase = createBrowserClient();
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("not_signed_in");

  const endpoint = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`;

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint,
      retryDelays: [0, 1000, 3000, 5000],
      chunkSize: SIX_MB, // Supabase requires exactly 6 MB chunks
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-upsert": "false",
      },
      metadata: {
        bucketName: "videos",
        objectName,
        contentType: file.type || "video/mp4",
        cacheControl: "3600",
      },
      onError: (err) => reject(err),
      onProgress: (sent, total) => onProgress(Math.round((sent / total) * 100)),
      onSuccess: () => resolve(),
    });
    // Resume ONLY a previous attempt that targeted this exact object path.
    upload
      .findPreviousUploads()
      .then((previous) => {
        const match = previous.find((p) => p.metadata?.objectName === objectName);
        if (match) upload.resumeFromPreviousUpload(match);
        upload.start();
      })
      .catch(reject);
  });
}
