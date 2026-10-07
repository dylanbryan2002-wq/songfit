"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fileExt } from "./fileExt";
import { readVideoDuration } from "./videoDuration";
import { uploadVideo } from "./upload";
import { LIMITS } from "@/src/shared/config";

type Creator = { id: string; email: string };
type Phase = "idle" | "checking" | "uploading" | "creating" | "error";

/** The server-issued upload target. Held in state so a retry reuses the SAME path and
 *  submission id; a new one is requested only when none is held or the server rejected it. */
type UploadTarget = { submissionId: string; path: string; token: string; signedUrl: string; ext: string };

const FAILED = "Upload didn't finish. Try again.";

export function UploadForm({ creator }: { creator: Creator }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [intent, setIntent] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<UploadTarget | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setPhase("idle");
    setTarget(null); // a different file gets a fresh target
    setFile(e.target.files?.[0] ?? null);
  }

  /** Reuse the held target when it matches this file's extension; otherwise ask the server for one. */
  async function getTarget(ext: string, sizeBytes: number): Promise<UploadTarget | "paywall"> {
    if (target && target.ext === ext) return target;
    const urlRes = await fetch("/api/upload-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ext, sizeBytes }),
    });
    if (urlRes.status === 402) return "paywall";
    if (urlRes.status === 429) throw new Error("Give it a minute and try again.");
    if (!urlRes.ok) throw new Error(FAILED);
    const issued = (await urlRes.json()) as Omit<UploadTarget, "ext">;
    const next: UploadTarget = { ...issued, ext };
    setTarget(next);
    return next;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!file) {
      setError("Pick a video first.");
      return;
    }
    const ext = fileExt(file);
    if (!ext) {
      setError("That file type isn't supported. Use MP4, MOV or WebM.");
      return;
    }
    if (file.size > LIMITS.maxUploadBytes) {
      setError("That video is over 150 MB. Try a shorter export.");
      return;
    }

    try {
      setPhase("checking");
      const duration = await readVideoDuration(file);
      if (duration > LIMITS.maxDurationSeconds) {
        setError("Keep it under 3 minutes for now.");
        setPhase("idle");
        return;
      }

      const issued = await getTarget(ext, file.size);
      if (issued === "paywall") {
        router.push("/subscribe");
        return;
      }
      const { submissionId, path, token, signedUrl } = issued;

      setPhase("uploading");
      setProgress(0);
      await uploadVideo({ file, path, token, signedUrl, onProgress: setProgress });

      setPhase("creating");
      const createRes = await fetch("/api/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ submissionId, path, ext, creatorIntent: intent.trim() || null }),
      });
      if (createRes.status === 402) {
        router.push("/subscribe");
        return;
      }
      if (createRes.status === 400 || createRes.status === 403) {
        // The server rejected this target (path/size/id mismatch). Drop it so the retry gets a new one.
        setTarget(null);
        throw new Error(FAILED);
      }
      if (!createRes.ok) throw new Error(FAILED);
      const { id } = (await createRes.json()) as { id: string };
      router.push(`/results/${id}`);
    } catch (err) {
      setPhase("error");
      const msg = err instanceof Error ? err.message : "";
      setError(msg.startsWith("Give it") || msg === FAILED ? msg : FAILED);
    }
  }

  const busy = phase === "checking" || phase === "uploading" || phase === "creating";

  return (
    <form onSubmit={onSubmit} className="mt-10 flex w-full max-w-md flex-col gap-4">
      <label
        htmlFor="video"
        className="flex h-64 w-full cursor-pointer items-center justify-center overflow-hidden rounded-3xl border border-dashed border-steel-light bg-white text-sm text-muted active:scale-[0.99]"
      >
        {previewUrl ? (
          <video src={previewUrl} muted playsInline className="h-full w-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-1 px-6 text-center">
            <span className="text-base font-semibold text-ink">Tap to choose a video</span>
            <span>MP4 or MOV, up to 3 minutes</span>
          </span>
        )}
        <input id="video" type="file" accept="video/*" className="sr-only" onChange={onPick} disabled={busy} />
      </label>

      {file && <p className="truncate text-center text-sm text-muted">{file.name}</p>}

      <input
        type="text"
        value={intent}
        onChange={(e) => setIntent(e.target.value)}
        maxLength={300}
        placeholder="What do you want this to feel like? (optional)"
        className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-base"
        disabled={busy}
      />

      {phase === "uploading" && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
          <div className="steel-gradient h-full transition-[width]" style={{ width: `${progress}%` }} />
        </div>
      )}

      {error && <p className="text-center text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="steel-gradient w-full rounded-2xl px-6 py-4 text-base font-semibold text-white disabled:opacity-60"
      >
        {phase === "checking" && "Checking your video"}
        {phase === "uploading" && `Uploading ${progress}%`}
        {phase === "creating" && "Almost there"}
        {(phase === "idle" || phase === "error") && "Find my songs"}
      </button>
      <p className="text-center text-xs text-muted">Signed in as {creator.email}</p>
    </form>
  );
}
