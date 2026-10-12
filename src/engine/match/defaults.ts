// Real dependencies for the new engine's recommend step (kept apart so tests can pass fakes).
import "server-only";
import { DICTIONARY } from "@/src/engine/catalog/dictionary";
import { findDeezerTrackById } from "@/src/engine/catalog/deezer";
import { normalizeKey } from "@/src/engine/catalog/normalize";
import { verifyCandidates } from "@/src/engine/catalog/verifyCandidates";
import { explainPicks } from "@/src/engine/explain/explainPicks";
import { getAnalysis, getAnalysisRow } from "@/src/db/queries/analyses";
import { getSubmission, setSubmissionStatus } from "@/src/db/queries/submissions";
import { replaceCandidates } from "@/src/db/queries/candidates";
import { replaceRecommendations } from "@/src/db/queries/recommendations";
import { listNotFoundSongs } from "@/src/db/queries/notFound";
import { logEvent } from "@/src/feedback/events";
import type { VideoProfile } from "@/src/analysis/videoProfile";
import type { NewDeps } from "./recommendNew";

const idByKey = new Map(DICTIONARY.map((s) => [normalizeKey(s.title, s.artist), s.id]));

export function newDeps(): NewDeps {
  return {
    songs: DICTIONARY,
    getSubmission: getSubmission as NewDeps["getSubmission"], // vibe_tags: cast until db:types includes 0008
    getStored: async (id) => {
      const [typed, row] = await Promise.all([getAnalysis(id), getAnalysisRow(id)]);
      if (!typed || !row) return null;
      // video_profile: cast until `pnpm db:types` includes 0012_new_engine.sql.
      const profile = ((row as unknown as { video_profile?: VideoProfile | null }).video_profile) ?? null;
      return { analysis: typed.analysis, brief: typed.brief, profile, transcript: row.transcript ?? undefined };
    },
    listNotFound: listNotFoundSongs,
    verify: (cands, d) => verifyCandidates(cands, {
      ...d,
      find: async (c) => { const id = idByKey.get(normalizeKey(c.title, c.artist)); return id ? findDeezerTrackById(id) : null; },
    }),
    explain: explainPicks,
    replaceCandidates, replaceRecommendations, setStatus: setSubmissionStatus, logEvent,
  };
}
