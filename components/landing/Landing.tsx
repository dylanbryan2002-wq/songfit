"use client";
import { useEffect, useRef, useState } from "react";
import { signInWithGoogle } from "../auth";
import { readVideoDuration } from "../videoDuration";
import { durationVerdict } from "../durationVerdict";
import { checkVideoFile, TOO_LONG } from "../videoChecks";
import { SignIn } from "../SignIn";
import { FileCard } from "./FileCard";
import { GoogleButton } from "./GoogleButton";
import { InAppNotice, useInAppBrowser } from "./InAppNotice";
import { sendLandingEvent } from "./landingEvent";
import { FLOW_ID_KEY, clearPendingUpload, readPendingUpload, stashPendingUpload } from "@/src/upload/pendingUpload";

type Chosen = { file: File; durationSeconds: number | null };

const SIGN_IN_UNFINISHED = "Sign-in didn't finish. Try again.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** This tab's flow id: kept in sessionStorage so a cancelled or failed Google round-trip finds the file again. */
function tabFlowId(): { id: string; existing: boolean } {
  try {
    const saved = sessionStorage.getItem(FLOW_ID_KEY);
    if (saved && UUID.test(saved)) return { id: saved, existing: true };
    const id = crypto.randomUUID();
    sessionStorage.setItem(FLOW_ID_KEY, id);
    return { id, existing: false };
  } catch {
    return { id: crypto.randomUUID(), existing: false };
  }
}

/** Signed-out first screen: choose a video first, then sign in with Google to upload it. */
export function Landing({ authFailed }: { authFailed: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const flowId = useRef("");
  const selection = useRef(0); // bumps on every pick; an older async check never replaces a newer pick
  const starting = useRef(false);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const inApp = useInAppBrowser();

  useEffect(() => {
    const { id, existing } = tabFlowId();
    flowId.current = id;
    sendLandingEvent("landing_viewed", id);
    if (authFailed) {
      setNotice(SIGN_IN_UNFINISHED);
      window.history.replaceState(null, "", "/");
    }
    if (existing) {
      const mine = selection.current;
      readPendingUpload(id)
        .then((rec) => {
          if (rec && selection.current === mine) setChosen({ file: rec.file, durationSeconds: rec.durationSeconds });
        })
        .catch(() => {});
    }
    // Back from Google via the back button: the page may come from the back-forward cache mid-"busy".
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      starting.current = false;
      setBusy(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [authFailed]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so picking the same file again still fires
    if (!file) return; // a cancelled Change keeps the current file
    const mine = ++selection.current;
    setError(null);
    setNotice(null);
    const problem = checkVideoFile(file);
    if (problem) {
      setChecking(false);
      setError(problem);
      return;
    }
    setChecking(true);
    const durationSeconds = await readVideoDuration(file);
    if (selection.current !== mine) return;
    setChecking(false);
    if (durationVerdict(durationSeconds) === "too_long") {
      setError(TOO_LONG);
      return;
    }
    clearPendingUpload(flowId.current).catch(() => {}); // a replaced file must not come back after sign-in
    setChosen({ file, durationSeconds });
    sendLandingEvent("video_chosen", flowId.current);
  }

  async function onContinue() {
    if (!chosen || starting.current) return;
    starting.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    const id = flowId.current;
    try {
      await stashPendingUpload(chosen.file, { flowId: id, durationSeconds: chosen.durationSeconds });
    } catch {
      starting.current = false;
      setBusy(false);
      setStorageFailed(true);
      return;
    }
    sendLandingEvent("sign_in_started", id);
    try {
      await signInWithGoogle(`/?resume=${id}`);
    } catch {
      starting.current = false;
      setBusy(false);
      setNotice(SIGN_IN_UNFINISHED);
    }
  }

  const choose = () => input.current?.click();

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-3">
      <input ref={input} type="file" accept="video/*" className="sr-only" tabIndex={-1} onChange={onPick} />
      {inApp ? (
        // A file chosen here cannot carry over to the real browser, so no choose/stash step either.
        <InAppNotice />
      ) : storageFailed ? (
        <SignIn message="Sign in, then upload your video." />
      ) : chosen ? (
        <>
          <FileCard
            file={chosen.file}
            durationSeconds={chosen.durationSeconds}
            onChange={choose}
            disabled={busy || checking}
          />
          <GoogleButton onClick={onContinue} disabled={busy || checking} />
          <p className="text-center text-xs leading-relaxed text-muted">
            From Google we use your name and email. After sign-in you start the upload; your video is analysed to
            find songs and never shown to other creators.{" "}
            <a href="/privacy" className="underline underline-offset-2">
              Privacy
            </a>
          </p>
        </>
      ) : (
        <button
          type="button"
          onClick={choose}
          disabled={checking}
          className="min-h-[52px] w-full rounded-2xl bg-ink px-6 text-base font-semibold text-white active:scale-[0.99] disabled:opacity-60"
        >
          {checking ? "Checking your video" : "Choose your video"}
        </button>
      )}
      {notice && <p className="text-center text-sm font-semibold text-ink">{notice}</p>}
      {error && <p className="text-center text-sm text-red-600">{error}</p>}
    </div>
  );
}
