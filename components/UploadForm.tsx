"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fileExt } from "./fileExt";
import { readVideoDuration } from "./videoDuration";
import { durationVerdict } from "./durationVerdict";
import { uploadVideo } from "./upload";
import { checkVideoFile, TOO_LONG } from "./videoChecks";
import { VibePicker } from "./VibePicker";
import { WaitingState } from "./WaitingState";
import { ResultsHeader, WAITING_MAIN } from "./ResultsHeader";
import { SignOutButton } from "./SignOutButton";
import { FileCard, VideoIcon } from "./landing/FileCard";
import { DemoLoop } from "./landing/DemoLoop";
import { GoogleButton } from "./landing/GoogleButton";
import { AREA, CTA, CTA_BAR, Headline, PickAFeel, STICKY } from "./landing/Hero";
import { signInWithGoogle } from "./auth";
import { VIBE_NOTE_MAX } from "@/src/shared/vibe";
import { LIMITS } from "@/src/shared/config";
import { uploadsLeftCopy } from "./accountCopy";

/** email null = anonymous visitor (landing page, before Google sign-in). */
type Creator = { email: string | null };
/** uploading/creating/error draw the waiting screen over the form; idle is the form. */
type Phase = "idle" | "uploading" | "creating" | "error";

/** The server-issued upload target. Held in state so a retry reuses the SAME path and
 *  submission id; a new one is requested only when none is held or the server rejected it. */
type UploadTarget = { submissionId: string; path: string; token: string; signedUrl: string; ext: string; uploaded: boolean };

const FAILED = "Upload didn't finish. Try again.";
export const DAILY_LIMIT = `You've used your ${LIMITS.dailyUploadsPerCreator} uploads for now. Each one frees up 24 hours after it was made.`;
export const DAILY_LIMIT_ANONYMOUS = `You've used your ${LIMITS.dailyUploadsAnonymous} free tries for now. Sign in to upload more.`;
const GLOBAL_LIMIT = "We're at capacity right now. Try again in a bit.";

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
  initialDurationSeconds = null,
  onStarted,
  uploadsLeft = null,
}: {
  creator: Creator;
  /** Uploads left under the rolling 24 h cap, counted server-side at render; null hides it. Advisory: not refreshed after a submit. */
  uploadsLeft?: number | null;
  /** A file kept across sign-in (landing page). Nothing starts until the creator taps the button. */
  initialFile?: File;
  /** Its length, already checked on the landing page. */
  initialDurationSeconds?: number | null;
  /** Called once when a submit actually starts (the landing stash is claimed here). */
  onStarted?: () => void;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(initialFile ?? null);
  const [durationSeconds, setDurationSeconds] = useState<number | null>(initialDurationSeconds);
  const [checking, setChecking] = useState(false); // reading the chosen file's length
  const selection = useRef(0); // the latest pick wins when two duration reads overlap
  const [intent, setIntent] = useState(""); // the "Anything else?" note
  const [vibeTags, setVibeTags] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<UploadTarget | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  // State updates are async; a second tap in the same frame must not start a second upload.
  const running = useRef(false);
  const videoInput = useRef<HTMLInputElement>(null);
  const noteInput = useRef<HTMLInputElement>(null);
  const [noteFlash, setNoteFlash] = useState(false); // "Something else…" points at the note
  const [noteOpen, setNoteOpen] = useState(false); // the note field shows only after "Something else…" (Dylan 2026-10-09)
  const [noteFocused, setNoteFocused] = useState(false); // the button leaves sticky so the keyboard can't trap it
  const dailyLimit = creator.email ? DAILY_LIMIT : DAILY_LIMIT_ANONYMOUS;

  useEffect(() => {
    if (!noteFlash) return;
    const t = setTimeout(() => setNoteFlash(false), 1500);
    return () => clearTimeout(t);
  }, [noteFlash]);

  function onSomethingElse() {
    setNoteOpen(true);
    setNoteFlash(true);
    // The input mounts on the next render; focus it then.
    requestAnimationFrame(() => {
      const el = noteInput.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  /** The length is checked here, when the file is chosen, so tapping "Find my songs" has nothing left to check. */
  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    const mine = ++selection.current;
    setError(null);
    setBlocked(null);
    setPhase("idle");
    setTarget(null); // a different file gets a fresh target
    setDurationSeconds(null);
    if (!picked) {
      setChecking(false);
      setFile(null);
      return;
    }
    setChecking(true);
    const seconds = await readVideoDuration(picked);
    if (selection.current !== mine) return;
    setChecking(false);
    if (durationVerdict(seconds) === "too_long") {
      setError(TOO_LONG);
      setFile(null);
      if (videoInput.current) videoInput.current.value = "";
      return;
    }
    setFile(picked);
    setDurationSeconds(seconds);
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
    if (urlRes.status === 429) {
      const body = (await urlRes.json().catch(() => null)) as { error?: unknown } | null;
      throw new Error(body?.error === "daily_limit" ? dailyLimit : "Give it a minute and try again.");
    }
    if (!urlRes.ok) throw new Error(FAILED);
    const issued = (await urlRes.json()) as Omit<UploadTarget, "ext" | "uploaded">;
    const next: UploadTarget = { ...issued, ext, uploaded: false };
    setTarget(next);
    return next;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (running.current || checking) return;
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
    // The waiting screen comes up on the tap; the upload is its first stage.
    setPhase("uploading");
    setProgress(0);
    try {
      const issued = await getTarget(ext, file.size);
      if (issued === "needs_subscription" || issued === "in_flight") {
        setBlocked(issued);
        setPhase("idle");
        return;
      }
      const { submissionId, path, token, signedUrl } = issued;

      if (!issued.uploaded) {
        await uploadVideo({ file, path, token, signedUrl, onProgress: setProgress });
        // The object now exists; a retry must not upload to it again (x-upsert is false).
        setTarget({ ...issued, uploaded: true });
      }

      setProgress(100);
      setPhase("creating");
      const createRes = await fetch("/api/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          submissionId,
          path,
          ext,
          creatorIntent: intent.trim() || null,
          vibe_tags: vibeTags,
        }),
      });
      if (createRes.status === 402) {
        setBlocked(await blockedReason(createRes));
        setPhase("idle");
        return;
      }
      if (createRes.status === 429) {
        const body = (await createRes.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(body?.error === "global_limit" ? GLOBAL_LIMIT : dailyLimit);
      }
      if (createRes.status === 400 || createRes.status === 403) {
        // The server rejected this target (path/size/id mismatch). Drop it so the retry gets a new one.
        setTarget(null);
        throw new Error(FAILED);
      }
      if (!createRes.ok) throw new Error(FAILED);
      const { id } = (await createRes.json()) as { id: string };
      // Stays on the waiting screen; the results page draws the same one and takes over.
      router.replace(`/results/${id}`);
    } catch (err) {
      setPhase("error");
      const msg = err instanceof Error ? err.message : "";
      setError(msg.startsWith("Give it") || msg === dailyLimit || msg === GLOBAL_LIMIT || msg === FAILED ? msg : FAILED);
    } finally {
      running.current = false;
    }
  }

  const busy = phase !== "idle";

  return (
    // A flex column on a phone; on a laptop its blocks sit straight in page.tsx's grid (AREA).
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-8 lg:contents">
      {/* The waiting screen, drawn over the form from the tap on; the form keeps its state underneath. */}
      {busy && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-canvas">
          <main className={WAITING_MAIN}>
            <ResultsHeader />
            <WaitingState
              submissionId={null}
              upload={{
                progress,
                error: phase === "error" ? error : null,
                // Back to the form with the same file, chosen vibes and note.
                onRetry: () => {
                  setError(null);
                  setPhase("idle");
                },
              }}
            />
          </main>
        </div>
      )}
      <input
        ref={videoInput}
        id="video"
        type="file"
        accept="video/*"
        className="sr-only"
        onChange={(e) => void onPick(e)}
        disabled={busy}
      />
      {file ? <PickAFeel /> : <Headline />}
      {file ? (
        <FileCard
          file={file}
          durationSeconds={durationSeconds}
          onChange={() => videoInput.current?.click()}
          onRemove={() => {
            setFile(null);
            setDurationSeconds(null);
            setError(null);
            setBlocked(null);
            if (videoInput.current) videoInput.current.value = "";
          }}
          disabled={busy}
        />
      ) : (
        <DemoLoop />
      )}

      {/* `contents` on a phone so the sticky bar's containing block is the whole form. */}
      <div className={`contents lg:flex lg:flex-col lg:gap-8 ${AREA.body}`}>
      {!file && (
        <label
          htmlFor="video"
          className="flex h-[150px] w-full cursor-pointer items-center justify-center rounded-3xl border border-dashed border-steel-light bg-white text-sm text-muted active:scale-[0.99]"
        >
          <span className="flex flex-col items-center gap-1 px-6 text-center">
            <VideoIcon />
            <span className="text-base font-semibold text-ink">Tap to choose a video</span>
            <span>MP4 or MOV, up to 150 MB (up to 3 minutes)</span>
          </span>
        </label>
      )}

      <VibePicker tags={vibeTags} onChange={setVibeTags} onSomethingElse={onSomethingElse} disabled={busy} />

      {noteOpen && (
      <input
        ref={noteInput}
        type="text"
        aria-label="Anything else?"
        value={intent}
        onChange={(e) => setIntent(e.target.value)}
        onFocus={() => setNoteFocused(true)}
        onBlur={() => setNoteFocused(false)}
        maxLength={VIBE_NOTE_MAX}
        placeholder="Anything else? e.g. the song is the punchline"
        className={`h-12 w-full scroll-mb-28 bg-ink/5 px-4 text-base text-ink placeholder:text-muted outline-none transition-shadow ${
          noteFlash ? "ring-2 ring-ink/30" : "focus:ring-2 focus:ring-ink/15"
        }`}
        disabled={busy}
      />
      )}

      {/* Sticky so the only action stays on screen above the chips; never disabled by the vibe step.
          Back in normal flow while the note is focused, so the keyboard can't push it over the field. */}
      <div className={noteFocused ? CTA_BAR : STICKY}>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {error === DAILY_LIMIT_ANONYMOUS && !creator.email && (
          <GoogleButton onClick={() => void signInWithGoogle("/")} />
        )}
        {blocked && (
          <p className="text-sm text-ink">
            {BLOCKED_COPY[blocked]}{" "}
            <Link href="/results/latest" className="font-semibold text-steel-dark underline underline-offset-2">
              Open my latest result
            </Link>
          </p>
        )}

        <button
          type="submit"
          disabled={busy || checking}
          className={CTA}
        >
          {checking ? "Checking your video" : "Find my songs"}
        </button>
        {uploadsLeft !== null && <UploadsLeft left={uploadsLeft} anonymous={!creator.email} />}
      </div>
      {creator.email && (
        <p className="flex flex-wrap items-center justify-center gap-1 text-xs text-muted lg:justify-start">
          Signed in as {creator.email}
          <span aria-hidden>·</span>
          <Link href="/account" className="inline-flex min-h-8 items-center px-1 font-semibold text-steel-dark">
            My Songfits
          </Link>
          <span aria-hidden>·</span>
          <SignOutButton className="!min-h-8 !px-1 text-xs" />
        </p>
      )}
      </div>
    </form>
  );
}

/** "7 uploads left" with the smaller reset hint; anonymous: "2 free tries left". */
function UploadsLeft({ left, anonymous }: { left: number; anonymous: boolean }) {
  const { line, hint } = uploadsLeftCopy(left, anonymous);
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
      <span className="font-semibold text-ink">{line}</span>
      {hint && <span className="text-[11px]">{hint}</span>}
    </p>
  );
}
