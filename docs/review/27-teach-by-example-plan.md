# Plan: teach the engine from the creators' choices we collected

Status: plan, nothing built. 2026-10-09. Owner: Dylan.

## Why

Until now the engine never saw what we learned. The 66 viral Reels with a known song, and Gemini's
write-up of each (what the music does, why it works), were only used to grade the engine. The engine
picked songs from general instructions and fell back on calm film scores and ambient beds. Codex's
root-cause review found the main failure: our picks match the topic but change the emotion (an
energetic founder story becomes reflective piano; a frantic routine becomes weary).

Creators pick for the joke, the era, the energy and familiarity. The fastest way to teach that is by
example: show the engine real cases of "a video like this, the creator chose this song, and this is
what it does for the viewer".

## What we have

- 45 practice Reels (tune split) with a known song and a Gemini write-up; 21 held out (test split).
- Per Reel: summary, what the music does (role: amplify 30, narration bed 34, punchline 2), Gemini's
  role note and "why it works", the song and artist (fingerprinted), and where in the song it starts.
- All 45 examples together are about 4,400 tokens: small enough to give the engine every time.

## Design

1. **Example file** `src/engine/candidates/creatorExamples.ts`, generated from the practice Reels
   only (never test clips), one entry each:
   video in one line · what the music does for the viewer · the song creators used · why it works.
   Written in plain words, no clip ids, handles or links. A script rebuilds it from
   `~/Songfit-groundtruth`, so every new Reel Dylan or Muse records becomes a new example.
2. **Song ideas see all examples.** The candidates system prompt gains a block:
   "Real Reels in this niche and the song the creator chose. Learn HOW they choose (the joke, the era,
   the energy, recognisable songs), not the list: only reuse one of these songs when it truly fits."
   The block is identical for every video, so it is sent with prompt caching (about 90 % cheaper after
   the first call). Extra cost per video: about 1–2 cents.
3. **Nothing else changes in this test**: same analysis, scoring and ranking as the current branch.

## Risks and guards

- **Copying**: the engine could hand out the example songs everywhere. Measure how often example songs
  appear in top 3s; more than about 1 in 5 means it is copying, not learning.
- **Leakage**: examples come from practice Reels only; the test is on the 21 held-out Reels.
- **Gemini mistakes**: Codex found some wrong genre labels. Song identity comes from the fingerprint,
  not Gemini; only Gemini's description of what the music does is used.
- **Niche narrowness**: examples are founder/student Reels; that is our target niche, so acceptable.

## Test (needs Dylan's go and the API limit raised)

- 21 held-out Reels. Control: the current branch engine (picks already saved). Treatment: same, plus
  examples. Only the song-idea and scoring steps rerun. Hard cap $15.
- Judged by Dylan's ears first: a listening page with each video's description, the creator's song,
  and both top 3s with Deezer links; Dylan picks which three feel closer. The model judge is reported
  alongside, not instead.
- Also reported: how often the real song (or its artist) is proposed at all, the copy rate above, and
  the most-repeated song.

## Later (if it works)

- Examples also guide the scorer, so energetic or funny picks stop losing to calm ones.
- Creators' own choices in Songfit become new examples automatically (the self-learning loop).

## v2 after Codex review (2026-10-09): small pilot

Codex: do not import all 45 write-ups (errors inside role_note / why_it_works, e.g. "Bad" described as
having no vocals); use 8–12 checked contrast lessons; freeze identical inputs; blind listening; enforce the cap.

- **Lessons**: 12 drafted from tune clips (Stereo Love, Miss Alissa, Vivaldi Summer, Law & Order, My Life,
  Bad, Brazil, Way Too Self Aware, Iris, Lazy Eye, Evergreen, Adagio in C Minor), each with what transfers
  and what is incidental. Dylan checks each against the original Reel:
  https://claude.ai/artifact/4RCxr53ergtCfZicM6FYmW (answers in its db collection `lessons`).
- **Test clips, fixed before any treatment run** (reserved/test split, 10): amplify or lift — Florida,
  Sparks, EARFQUAKE, I Need a Dollar (instrumental), Sailor Song; comic — Le Chat du Rabbin (napping);
  quiet bed — Akatsuki (monk mode), Odysseus, Overcome, One More Light. Excluded: Dimensions (song also in
  tune), clips without a base run or video.
  Ids: 19-12-44, 23-42-21, 23-02-48, 23-24-40, 19-20-01, 23-26-36, 19-03-11, 22-56-06, 22-57-54, 22-49-29
  (screenrecording-10-08-2026-<id>-1).
- **Arms**: identical frozen analysis and brief (the round-2 analysis, i.e. older briefs without
  music_job), identical downstream code; only the lesson block differs. This tests lessons on old
  briefs, not the whole current pipeline.
- **Cap**: $15 enforced in the runner; first 2 clips measure real cost before continuing.
- **Judgement**: Dylan's blind listening (local page: original video with each candidate's 30 s sample,
  shuffled, A / B / both / neither; labelled a sample-level audition). Model judge skipped.
