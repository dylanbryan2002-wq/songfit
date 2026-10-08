"use client";

export type LandingEventName = "landing_viewed" | "video_chosen" | "sign_in_started" | "sign_in_completed";

/** Fire-and-forget funnel event. Only the name and the random flow id leave the device. */
export function sendLandingEvent(name: LandingEventName, flowId: string): void {
  fetch("/api/landing-events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, flow_id: flowId }),
    keepalive: true, // survives the navigation to Google
  }).catch(() => {});
}
