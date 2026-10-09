"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { signInWithGoogle } from "../auth";
import { readVideoDuration } from "../videoDuration";
import { durationVerdict } from "../durationVerdict";
import { checkVideoFile, TOO_LONG } from "../videoChecks";
import { SignIn } from "../SignIn";
import { ensureAnonSession } from "./anonSession";
import { CHOOSE, NO_SIGN_UP } from "./copy";
import { DemoLoop } from "./DemoLoop";
import { FileCard } from "./FileCard";
import { GoogleButton } from "./GoogleButton";
import { AREA, CTA, Headline, STICKY } from "./Hero";
import { InAppNotice, useInAppBrowser } from "./InAppNotice";
import { sendLandingEvent } from "./landingEvent";
import { FLOW_ID_KEY } from "@/src/upload/flowId";

/** Loaded on the first tap of "Choose your video", not with the page: supabase-js, the IndexedDB keeper and the
 *  upload form (chips, tus) stay off the main thread until a creator acts. A kept file from an earlier visit loads
 *  the IndexedDB code at mount, only for that tab. */
const loadUploadForm = () => import("../UploadForm");
const loadPending = () => import("@/src/upload/pendingUpload");
const loadSupabase = () => import("@/src/db/browser");
const UploadForm = dynamic(() => loadUploadForm().then((m) => m.UploadForm), { ssr: false });
const clearPendingUpload = (flowId: string) => loadPending().then((m) => m.clearPendingUpload(flowId));

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

/** Signed-out first screen: choose a video, then the upload form runs under an anonymous session
 *  (Google sign-in comes at the results). If anonymous sign-in fails, sign in with Google first.
 *  `anonymousLive` shows "No sign-up to start."; true only once anonymous sign-in is switched on.
 *  `uploadsLeft`: an existing anonymous session's allowance, counted server-side; null when unknown.
 *  `matched`: ready submissions so far, for the social-proof line (Headline hides it under SOCIAL_PROOF_MIN). */
export function Landing({
  authFailed,
  anonymousLive = false,
  uploadsLeft = null,
  matched = null,
}: {
  authFailed: boolean;
  anonymousLive?: boolean;
  uploadsLeft?: number | null;
  matched?: number | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const flowId = useRef("");
  const selection = useRef(0); // bumps on every pick; an older async check never replaces a newer pick
  const starting = useRef(false);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [anonFile, setAnonFile] = useState<File | null>(null); // set once an anonymous session exists
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
      loadPending()
        .then((m) => m.readPendingUpload(id))
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
    sendLandingEvent("video_chosen", flowId.current);
    setChecking(true);
    let session: Awaited<ReturnType<typeof ensureAnonSession>>;
    try {
      session = await ensureAnonSession((await loadSupabase()).createBrowserClient().auth);
    } catch {
      session = "failed"; // the chunk did not load (offline): Google first, as before
    }
    if (selection.current !== mine) return;
    setChecking(false);
    if (session === "failed") {
      setChosen({ file, durationSeconds }); // fallback: Google first, as before
      return;
    }
    if (session === "started") sendLandingEvent("anon_session_started", flowId.current);
    setAnonFile(file);
  }

  async function onContinue() {
    if (!chosen || starting.current) return;
    starting.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    const id = flowId.current;
    try {
      const { stashPendingUpload } = await loadPending();
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

  const choose = () => {
    input.current?.click();
    // Warm the code the pick needs while the picker is open. Failures surface (and fall back) where it is used.
    for (const load of [loadSupabase, loadPending, loadUploadForm]) load().catch(() => {});
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="video/*"
        aria-label={CHOOSE}
        className="sr-only"
        tabIndex={-1}
        onChange={onPick}
      />
      <LandingView
        view={anonFile ? "anon" : inApp ? "inApp" : storageFailed ? "storageFailed" : chosen ? "chosen" : "empty"}
        anonFile={anonFile}
        chosen={chosen}
        checking={checking}
        busy={busy}
        notice={notice}
        error={error}
        anonymousLive={anonymousLive}
        uploadsLeft={uploadsLeft}
        matched={matched}
        onChoose={choose}
        onContinue={onContinue}
        onRemove={() => {
          clearPendingUpload(flowId.current).catch(() => {});
          setChosen(null);
        }}
      />
    </>
  );
}

export type LandingViewName = "empty" | "chosen" | "inApp" | "storageFailed" | "anon";

/** The signed-out page in one state; holds no state itself. Its blocks sit in page.tsx's grid (AREA). */
export function LandingView({
  view,
  anonFile = null,
  chosen = null,
  checking = false,
  busy = false,
  notice = null,
  error = null,
  anonymousLive = false,
  uploadsLeft = null,
  matched = null,
  onChoose = () => {},
  onContinue = () => {},
  onRemove = () => {},
}: {
  view: LandingViewName;
  anonFile?: File | null;
  chosen?: Chosen | null;
  checking?: boolean;
  busy?: boolean;
  notice?: string | null;
  error?: string | null;
  anonymousLive?: boolean;
  uploadsLeft?: number | null;
  matched?: number | null;
  onChoose?: () => void;
  onContinue?: () => void;
  onRemove?: () => void;
}) {
  const messages = (
    <>
      {notice && <p className="text-sm font-semibold text-ink">{notice}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </>
  );

  if (view === "anon" && anonFile) {
    return (
      <>
        <UploadForm creator={{ email: null }} initialFile={anonFile} uploadsLeft={uploadsLeft} />
        <div className={`flex flex-col gap-3 ${AREA.note}`}>
          <p className="text-xs text-muted">
            Your video is stored by Songfit and analyzed with third-party AI services to find your songs.
          </p>
          {messages}
        </div>
      </>
    );
  }

  if (view === "chosen" && chosen) {
    // Google fallback: the H1 stays, the clip replaces the demo, no sticky button.
    return (
      <>
        <Headline matched={matched} />
        <FileCard
          file={chosen.file}
          durationSeconds={chosen.durationSeconds}
          onChange={onChoose}
          onRemove={onRemove}
          disabled={busy || checking}
        />
        <div className={`flex flex-col items-center gap-3 lg:items-start ${AREA.body}`}>
          <GoogleButton onClick={onContinue} disabled={busy || checking} />
          <p className="text-xs leading-relaxed text-muted">
            From Google we use your name and email. After sign-in you start the upload; your video is analysed to
            find songs and never shown to other creators.{" "}
            <a href="/privacy" className="underline underline-offset-2">
              Privacy
            </a>
          </p>
          {messages}
        </div>
      </>
    );
  }

  return (
    <>
      <Headline matched={matched} />
      <DemoLoop />
      {view === "inApp" ? (
        // A file chosen here cannot carry over to the real browser: no chooser, no sticky button.
        <div className={`flex flex-col gap-3 ${AREA.body}`}>
          <InAppNotice />
          {messages}
        </div>
      ) : view === "storageFailed" ? (
        <div className={`flex flex-col gap-3 ${AREA.body}`}>
          <SignIn message="Sign in, then upload your video." />
          {messages}
        </div>
      ) : (
        // `contents` on a phone so the sticky bar's containing block is the whole page, not this div.
        <div className={`contents lg:block ${AREA.body}`}>
          <div className={STICKY}>
            {messages}
            <button type="button" onClick={onChoose} disabled={checking} className={CTA}>
              {checking ? "Checking your video" : CHOOSE}
            </button>
            {anonymousLive && <p className="text-xs text-muted">{NO_SIGN_UP}</p>}
          </div>
        </div>
      )}
    </>
  );
}
