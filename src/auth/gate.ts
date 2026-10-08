export type GateDecision = "not_found" | "waiting" | "gate" | "picker";

/**
 * What the results page shows. An anonymous owner never gets the picker: a ready run shows the
 * sign-in gate instead, and nothing from the list is loaded.
 */
export function gateDecision(
  viewer: { id: string; anonymous: boolean; admin: boolean },
  submission: { creator_id: string; status: string },
): GateDecision {
  if (submission.creator_id !== viewer.id && !viewer.admin) return "not_found";
  if (submission.status !== "ready") return "waiting";
  return viewer.anonymous ? "gate" : "picker";
}
