"use client";
import { useEffect, useState } from "react";
import { isInAppBrowser, SITE_LINK } from "./inAppBrowser";

/** False on the server and the first render; true after mount inside an app's built-in browser. */
export function useInAppBrowser(): boolean {
  const [inApp, setInApp] = useState(false);
  useEffect(() => setInApp(isInAppBrowser(navigator.userAgent)), []);
  return inApp;
}

/** Shown instead of the Google button inside Instagram/Facebook/TikTok, where Google sign-in fails. */
export function InAppNotice() {
  const [copied, setCopied] = useState<boolean | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(SITE_LINK);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="flex w-full flex-col items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 text-center">
      <p className="text-sm font-semibold text-ink">
        Google sign-in doesn&apos;t work inside this app. Tap ⋯ (or the share icon) and choose &quot;Open in
        browser&quot;.
      </p>
      <button
        type="button"
        onClick={() => void copy()}
        className="min-h-11 rounded-full bg-ink px-5 text-sm font-semibold text-white active:scale-[0.99]"
      >
        {copied ? "Copied" : "Copy link"}
      </button>
      {copied === false && <p className="select-all text-sm text-muted">{SITE_LINK}</p>}
    </div>
  );
}
