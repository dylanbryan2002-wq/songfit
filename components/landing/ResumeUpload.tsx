"use client";
import { useEffect, useState } from "react";
import { UploadForm } from "../UploadForm";
import { AREA } from "./Hero";
import { sendLandingEvent } from "./landingEvent";
import { FLOW_ID_KEY, clearPendingUpload, readPendingUpload } from "@/src/upload/pendingUpload";

type Creator = { id: string; email: string };
type State = { kind: "loading" } | { kind: "found"; file: File; durationSeconds: number | null } | { kind: "missing" };

/** Back from Google with ?resume=<flowId>: offer the kept file. Nothing uploads until "Find my songs". */
export function ResumeUpload({ creator, flowId }: { creator: Creator; flowId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    readPendingUpload(flowId)
      .then((rec) => {
        if (!live) return;
        if (!rec) return setState({ kind: "missing" });
        setState({ kind: "found", file: rec.file, durationSeconds: rec.durationSeconds });
        // Once per flow per browser, not on every reload of /?resume=.
        const sent = `songfit.signInCompleted:${flowId}`;
        try {
          if (sessionStorage.getItem(sent)) return;
          sessionStorage.setItem(sent, "1");
        } catch {
          // no sessionStorage: send anyway
        }
        sendLandingEvent("sign_in_completed", flowId);
      })
      .catch(() => live && setState({ kind: "missing" }));
    return () => {
      live = false;
    };
  }, [flowId]);

  if (state.kind === "loading") return <div aria-busy className={`h-64 w-full ${AREA.body}`} />;
  if (state.kind === "missing") {
    return (
      <>
        <p className={`text-sm font-semibold text-ink ${AREA.note}`}>Pick your video again to continue.</p>
        <UploadForm creator={creator} />
      </>
    );
  }
  return (
    <UploadForm
      creator={creator}
      initialFile={state.file}
      initialDurationSeconds={state.durationSeconds}
      onStarted={() => {
        // Claim the kept copy: one tap, one upload. A failed upload retries from the file still on screen.
        clearPendingUpload(flowId).catch(() => {});
        try {
          sessionStorage.removeItem(FLOW_ID_KEY);
        } catch {
          // private mode: nothing to remove
        }
      }}
    />
  );
}
