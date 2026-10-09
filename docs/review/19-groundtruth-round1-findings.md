# 19 — Ground-truth round 1: what the engine gets wrong (2026-10-09)

Source: `~/Songfit-groundtruth/reports/2026-10-09-round1.md` (46 clips Dylan recorded on 2026-10-08, all run through
the live engine muted, Gemini's with-sound analysis beside each; song truth from ACRCloud fingerprints, the on-screen
audio label, and Gemini where it was confident). Script: `scripts/groundtruth/` (docs/review/18).

## The set

46 viral Reels from Dylan's target audience (storytellers and UGC-style creators). 34 of 46 are a person talking over
a quiet instrumental bed (Gemini role "narration"); 10 use the music to amplify a montage or reveal; 2 use it as the
punchline. Gemini heard no vocals on 42 of 46 and called the track obscure on 39 of 46.

Song truth: 30 clips (ACRCloud on the raw audio found 13; stripping the voice first with demucs raised it to 29; one
from Gemini). 16 clips remain without a song: beds the fingerprinter cannot name even with the voice removed, most
likely creator-made or unreleased library tracks. Four matches scored under 90 and are kept as unconfirmed.

## Results on the 30 with a known song (17 at the first count; numbers updated after voice separation)

| | |
|---|---|
| Hit (real song in our 15) | 1 of 30, at rank 14, section exact (Can You Hear The Music, Göransson) |
| Artist hit | 1 (we offered Göransson's other score instead of Sirens) |
| Miss, never generated | 27 |
| Miss, generated but dropped at Deezer verification | 1 (On the Nature of Daylight, Max Richter: no Deezer match found) |
| Miss, generated and verified but scored out of the 15 | 1 (Sailor Song, Gigi Perez) |
| Engine produced nothing | 6 of 46 before reruns: 2 cut-off candidates calls, 4 network drop |

## What the misses have in common

1. **The brief is mostly right; the candidate list is wrong.** On the Law & Order clip our brief said "crime drama TV
   theme / detective noir / meme sound" and the model proposed Peter Gunn, Watching the Detectives and Fission. On the
   no-phone party it said "nu-disco / house-lite / 2000s electro-pop" and proposed Murder on the Dancefloor and Music
   Sounds Better With You, not Stereo Love. The model reaches for the tasteful cousin of the song creators actually use.
2. **We ask for "recognizable, not overused" on 39 of 46 clips.** Creators chose the overused one on purpose for every
   punchline and most montages (Law & Order, Stereo Love, Sailor Song, Florida). Our originality and cultural
   dimensions then penalise exactly that: Sailor Song was generated, verified, and scored out with originality 0.2
   ("Stock Reels choice") and cultural 0.5 ("heavily used, peaking out"). It was the right answer.
3. **Our pacing score punished the right section.** Sailor Song's pacing was 0.15, reason "Hook 5s in; missed". The
   real edit starts the song at 0 s so the drop lands on the cut at 4.5 s. A hook five seconds in was the point.
4. **Talking heads use lo-fi and library beds the model never proposes.** Bliss by klsr (twice), Another Thrill by
   Regikid, Kevin MacLeod's Scheming Weasel, Her by The American Dawn, Every Living Breathing Moment by Grant Steller.
   Checked on Deezer 2026-10-09: every one is there WITH a sample (Dylan's point; my first draft said the catalog
   lacked them, which was wrong). The gap is knowledge, not access: the model does not know these tracks exist, so the
   candidates step cannot name them. The fix is a second candidate source, the catalog path the architecture already
   reserves (`songs` table, `source = catalog`): seed it with the beds the fingerprint pipeline finds on viral clips,
   tagged with Gemini's mood/energy, and merge matches into the candidate list for narration-role briefs.
5. **A famous song was dropped at verification, and the cause is a title format.** On the Nature of Daylight was
   proposed; Deezer lists it as "Richter: On the Nature of Daylight" (classical "Composer: Title" style), and the
   core-title match fails on the prefix. Normaliser fix: strip a leading "<artist surname>: " before comparing.
6. **Reliability: 2 of 46 runs died on the 12k output cap** (the candidates call at medium effort now spends 7–10k
   tokens of hidden reasoning). Same finding as the smoke run; the fix (retry that direction once at low effort) is
   still waiting for a go.

Where we agree with Gemini: dialogue detection (ours 37 true, Gemini 40), instrumental preference (ours 40, Gemini 42),
energy within a step on most clips. The analysis stage is not the problem.

## Proposed changes, in order of expected effect

A. **candidates-v6.** Add to each direction: "name the songs creators on Reels and TikTok actually use for this kind of
   moment this year, including heavily used ones; a famous overused song that fits the joke beats a tasteful obscure
   one." For narration-role clips (dialogue present, instrumental brief), add a fourth direction "quiet bed": well-known
   lo-fi, ambient and neo-classical tracks that exist on Deezer, chosen to stay under speech.
B. **Scoring.** Stop penalising overuse when the brief's role is punchline or amplify (originality and cultural
   dimensions). Pacing: a hook inside the first 5 s is a plus on clips under 15 s, not a miss. Weights.ts untouched
   unless Dylan says so.
C. **Verification.** Strip the classical "Composer: " title prefix in the normaliser (the Max Richter miss).
E. **Catalog seed (after Sunday).** Insert fingerprinted beds from viral clips into `songs` and merge them as a
   second candidate source for narration-role briefs; this is the manual-now version of the catalog retrieval stage.
D. **Reliability.** The low-effort retry on a cut-off candidates call.

Measure: rerun `--tag round2` after A and B. Hit rate on the known-song clips must rise from 1/30; the stage split
should move from "not generated" to "scored out" or hits. Section error stays at 0 on hits.

## Not yet usable as evidence

- 16 clips without song truth (Dylan checks the audio label on those Reels).
- Four fingerprints under score 90 (Bad by Michael Jackson 82, Yas Queen 76, Look My Eyes 88, Bliss first pass 73
  then 100 after separation) are kept in the CSV with their score and not trusted on their own.
- 13 extra videos with no Gemini reply were left out of the run.
