"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fileExt } from "./fileExt";
import { readVideoDuration } from "./videoDuration";
import { durationVerdict } from "./durationVerdict";
import { uploadVideo } from "./upload";
import { checkVideoFile, TOO_LONG } from "./videoChecks";

type Creator = { id: string; email: string };
type Phase = "idle" | "checking" | "uploading" | "creating" | "error";

/** The server-issued upload target. Held in state so a retry reuses the SAME path and
 *  submission id; a new one is requested only when none is held or the server rejected it. */
type UploadTarget = { submissionId: string; path: string; token: string; signedUrl: string; ext: string; uploaded: boolean };

const FAILED = "Upload didn't finish. Try again.";

/** Why the server said 402 (src/billing/paywall.ts). The create step only knows "needs_subscription". */
type Blocked = "needs_subscription" | "in_flight";
const BLOCKED_COPY: Record<Blocked, string> = {
  needs_subscription: "Your free result is used. Paid plans are coming.",
  in_flight: "Your last video is still being worked on.",
};

async function blockedReason(res: Response): Promise<Blocked> {
  const body = (await res.json().catch(() => null)) as { reason?: unknown } | null;
  return body?.reason === "in_flight" ? "in_flight" : "needs_subscription";
}

export function UploadForm({
  creator,
  initialFile,
  onStarted,
}: {
  creator: Creator;
  /** A file kept across sign-in (landing page). Nothing starts until the creator taps the button. */
  initialFile?: File;
  /** Called once when a submit actually starts (the landing stash is claimed here). */
  onStarted?: () => void;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(initialFile ?? null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [intent, setIntent] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<UploadTarget | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  // State updates are async; a second tap in the same frame must not start a second upload.
  const running = useRef(false);

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
    setBlocked(null);
    setPhase("idle");
    setTarget(null); // a different file gets a fresh target
    setFile(e.target.files?.[0] ?? null);
  }

  /** Reuse the held target when it matches this file's extension; otherwise ask the server for one. */
  async function getTarget(ext: string, sizeBytes: number): Promise<UploadTarget | Blocked> {
    if (target && target.ext === ext) return target;
    const urlRes = await fetch("/api/upload-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ext, sizeBytes }),
    });
    if (urlRes.status === 402) return blockedReason(urlRes);
    if (urlRes.status === 429) throw new Error("Give it a minute and try again.");
    if (!urlRes.ok) throw new Error(FAILED);
    const issued = (await urlRes.json()) as Omit<UploadTarget, "ext" | "uploaded">;
    const next: UploadTarget = { ...issued, ext, uploaded: false };
    setTarget(next);
    return next;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (running.current) return;
    setError(null);
    setBlocked(null);

    if (!file) {
      setError("Pick a video first.");
      return;
    }
    const problem = checkVideoFile(file);
    const ext = fileExt(file);
    if (problem || !ext) {
      setError(problem);
      return;
    }

    running.current = true;
    onStarted?.();
    try {
      setPhase("checking");
      const duration = await readVideoDuration(file);
      if (durationVerdict(duration) === "too_long") {
        setError(TOO_LONG);
        setPhase("idle");
        return;
      }

      const issued = await getTarget(ext, file.size);
      if (issued === "needs_subscription" || issued === "in_flight") {
        setBlocked(issued);
        setPhase("idle");
        return;
      }
      const { submissionId, path, token, signedUrl } = issued;

      setPhase("uploading");
      setProgress(0);
      if (!issued.uploaded) {
        await uploadVideo({ file, path, token, signedUrl, onProgress: setProgress });
        // The object now exists; a retry must not upload to it again (x-upsert is false).
        setTarget({ ...issued, uploaded: true });
      }

      setPhase("creating");
      const createRes = await fetch("/api/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ submissionId, path, ext, creatorIntent: intent.trim() || null }),
      });
      if (createRes.status === 402) {
        setBlocked(await blockedReason(createRes));
        setPhase("idle");
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
    } finally {
      running.current = false;
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
            <span>MP4 or MOV, up to 50 MB (about a minute)</span>
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
      {blocked && (
        <p className="text-center text-sm text-ink">
          {BLOCKED_COPY[blocked]}{" "}
          <Link href="/results/latest" className="font-semibold text-steel-dark underline underline-offset-2">
            Open my latest result
          </Link>
        </p>
      )}

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
