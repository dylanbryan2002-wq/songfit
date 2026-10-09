# Plan: weighting songs from creator "background music" lists — v3 after Codex review 2

Status: proposal, nothing built. v1 written 2026-10-09; v2 same day after Codex's review (kept below in
`docs/review/24-codex-review-v1.md`). Owner: Dylan. Author: Claude (engine session). Reviewer: Codex.

## 00. v3: what changed after Codex review 2 (supersedes anything below that conflicts)

1. **Control stays comparable.** No speech recovery in this experiment. A (round 2), B and C all use
   the same cached analysis and brief per clip, from round 2. B reuses round 2's analysis and reruns
   only recommend. The judge sees that same analysis for both arms. Speech recovery (demucs vocals to
   Whisper) becomes its own later experiment, after a spot check for song lyrics leaking into stems.
   Narration limitation is reported, not fixed.
2. **Duration**: v2's claim was wrong; see the corrected table. Only the saved metadata is fixed.
3. **C replay** runs combine → diversify → selectSections on all of B's verified candidates, with the
   prior passed as an explicit experimental weight config, never by editing the default in
   `weights.ts`. Gate before trusting C: replay B with the prior off must reproduce B's ordered picks
   and section times exactly. When the speech gate is false, C uses the baseline weights (no neutral
   compression). C is judged as scored picks, no invented explanations.
4. **Storytelling rule**: no pronoun test. Personal event or change plus temporal progression in
   `story` or summary, word-boundary matching, checked against blind tune labels. Precision needs at
   least 5 predicted positives; support and recall reported. `brief.fields.moods` is treated as the
   model's desired feel, not a creator request.
5. **Text-reel type** dropped (unreachable under the speech gate). Results split into eligible speech
   clips and all clips.
6. **Source counts** derived from records, one dependence policy: L3 and L4 merged into one group for
   any song both name. Runaway is 3 groups, Money So Big 2. The word "independent" is dropped; tables
   say "groups".
7. **Shortlist**: canonical display title and artist from the Deezer resolution (raw transcription
   kept separately), sample-less entries filtered, deduplicated by Deezer id before the cap of 8. L1
   mentions kept with raw provenance and no type. Prompt wording: creators "recommend", not "use".
8. **Explanations untouched** in B and C. `topReasons` filters out only `creator_prior`, and only if C
   ever ships, with an explain prompt-version bump.
9. **Decision rule**: identical song and section pairs tie automatically; a one-arm failure is a loss
   for that arm; judge-call failures get their own status and one retry. Report wins / losses / ties,
   decided pairs, failures and a paired sign-test interval. B or C chosen on tune; the chosen arm is
   then tested against A on test and must have **positive** net wins (zero is inconclusive). Sameness
   compared on matching splits. Hit rate reported on the identified subset with its denominator.
10. **Storage**: `song_trend_signals` cannot hold source groups or version-specific evidence; the
    curated file is the record, and any future adapter into that table is lossy and documented as such.

Cost of B under v3: one recommend-only run on 63 tune clips (≈ $30, ≈ 1 h with two workers), then 30
test clips (≈ $15) after freezing. C costs judge calls only.

## 0. What changed from v1

Accepted from the review:

- **Sequence.** Generation assistance first, scoring unchanged; the rule prior is a second, separate
  treatment evaluated on the same candidate pool. Three arms: round-2 control, generation-only,
  generation-plus-prior.
- **No exemptions in the first experiment.** The stock-choice and overuse rules stay as they are. Advice
  and saturation are different signals; whether the stock rule is too broad is studied on its own later.
- **Prior values.** Neutral 0.5 for everything not matched, including listed songs whose type does not
  match. Applies only when someone is talking (the lists are background-music lists). Name
  `creator_prior`, not `proven`.
- **Shortlist, not "include every one".** At most eight resolved, non-banned recordings offered in the
  `safe` prompt; the model chooses the ones that fit. Measured as a funnel, no 80 % gate.
- **Keep the prior out of explanations.** `explainPicks.topReasons` reads only model-scored dimensions.
- **Provenance.** Per-source type assignments, not a union with a count; copies reconciled; lookups by
  Deezer id; versions (slowed, instrumental, piano) do not inherit each other's evidence; the file is a
  curated source with a future adapter, not a copy of `song_trend_signals`.
- **Mapping.** Rules with abstention, judged by per-type precision on the tune split, no coverage quotas,
  uncertain one-off categories dropped, the creator's requested feel in the brief respected.
- **Evaluation.** Symmetric judge; paired blinded control-vs-treatment as the primary metric; tune on the
  tune split only, one final test run; failed runs counted; a real gain required, not "nothing worse".
- **Zod.** v1 was wrong: the repo is on Zod 3, enum-keyed records are not exhaustive. Old rows render
  already (`CandidatesTable.tsx` shows a dash for a missing dimension).

Corrected numbers (Codex asked for clip-level denominators):

| measurement | v1 said | correct |
|---|---|---|
| ground-truth clips whose real song is on a list | "7 of 62 tracks" | **8 of 66 clips**, and 3–4 of those are loose title matches (Home, Dimensions). Realistic ceiling: 4–5 clips, 6–8 points of hit rate. |
| list songs' share of picks | 4.2 % of all 15 picks | **4.7 % of top-5 picks** (22 of 465) |
| any single list song's reach | not measured | Million Dollar Baby and Metamorphosis each in 4 of 93 clips' top 5 |
| **sameness we already have** | not measured | **saman (Ólafur Arnalds) is in the top 5 of 21 of 93 clips**, Near Light 15, Time 14, Awake 12. The engine already gives a quarter of creators the same quiet bed. Sameness is a pre-existing problem, and the guardrail below measures it for every song, not only listed ones. |
| `dialogue_present` reliability (harness is muted, so it is inferred from frames and captions) | not checked | agrees with Gemini's label, which heard the audio, on **83 of 93** clips; ours says true on 76, Gemini on 86. The harness under-detects speech on about 10 clips. |
| harness `duration_seconds` | assumed present | missing only in the **saved** analysis; `ours.ts` passes duration into the engine and `recommend.ts` enriches the analysis, so the pacing rule did fire (v2 was wrong; Codex review 2). Saved file gets the field for offline replay. |

Not accepted, with reasons:

- Codex suggested the prior might apply per music role. Our analysis has no music-role field, only
  `dialogue_present`; adding one is a schema change. The dialogue gate is the honest proxy this week.
- Codex wants human listening for section and dialogue fit. Agreed in principle; this week the only
  human is Dylan, and the ten-clip sheet is what he can do. Reported as a smoke test, not evidence.

## 1. What the reviewer needs to know

Songfit takes a creator's Reel, analyses it, and returns song *sections* (song + start + end).
Engine stages, in order (`docs/ARCHITECTURE.md`):

| stage | file | what it does today |
|---|---|---|
| analysis | `src/analysis/` | frames + Whisper → `VideoAnalysis` (summary, content_category, mood[], energy, pacing, dialogue_present, important_moments) + `MusicBrief` |
| candidates | `src/engine/candidates/generateCandidates.ts` | three parallel model calls (directions `safe`, `current`, `unexpected`), 25 songs each, each with a proposed window; merged by `normalizeKey` |
| catalog | `src/engine/catalog/verifyCandidates.ts` | Deezer search; no 30 s sample → dropped; identity is `catalog_key = deezer:<id>` |
| scoring | `src/engine/scoring/` | six model-scored dimensions in one batched call (`modelScores.ts`) + two rule dimensions (`dialogue.ts`, `overuse.ts`); `weights.ts` combines; every component score is stored on the candidate row (`component_scores` jsonb) |
| diversify | `src/engine/diversify/diversify.ts` | 15 picks, rank 1 = top total, then rotates directions; artist tolerance 0.1 |
| explain | `src/engine/explain/explainPicks.ts` | creator-facing copy; reads the two highest-scoring component *reasons* per pick |

Readers of stored scores: `components/admin/CandidatesTable.tsx` (dash for a missing dimension),
`scripts/quality-run.ts`, `explainPicks.topReasons`. None parses rows through `ScoredCandidate`.

Rules that bind this plan (`CLAUDE.md`): weights live only in `weights.ts` and changing them needs
Dylan's OK; one file per scoring dimension returning `{ score: 0..1, reason }`; every component score is
stored; no stage reads another stage's table; model outputs parsed with Zod; `PROMPT_VERSION` bumped on
any prompt change; creators never see scores or jargon; manual-now, automated-later.

Evaluation harness (`scripts/groundtruth/`, `docs/review/18`, `19`): 93 viral Reels screen-recorded by
Dylan, 66 with the real song identified (Gemini + ACRCloud), run through the live engine on a muted
copy. Split: 63 tune, 30 test (sha1 of the clip id). Round 1 baseline: 1 hit in 66; 27 of the first 30
misses were "never generated". Round 2 (candidates-v6, scoring-v4) is running now and is the control.

## 2. The data

Eight "background music for your videos" Reels, transcribed by Gemini. Six independent list groups
(one list appears three times with small transcription differences). 75 unique titles, 127 mentions.
Each creator tags songs with a video type. Full transcription in the appendix.

Nature of the data, which drives the design:

1. They are explicitly **background** lists ("this is not trending audios, this is actual music in the
   background of your video"): the song under a talking creator. 76–86 of our 93 clips have speech.
2. They are **advice, not evidence**. But they are widely watched, so they describe what a creator in
   this niche would reach for. That is a prior on *cultural fit*, nothing more. It says nothing about
   originality or saturation.

Consensus, counted per independent list group and per type:

| song | groups | per-type evidence |
|---|---|---|
| Runaway — Kanye West | 4 | storytelling 2, emotional 1, inspiring 1 |
| Dark Red — Steve Lacy | 4 | educational 3, emotional 1 |
| Money So Big — Yeat | 3 | educational 3 |
| New Home — Austin Farwell | 3 | emotional 2, sad 1 (slowed and piano-cello versions named; evidence stays per version) |
| Mrs Magic — Strawberry Guy | 3 | emotional 2, deep 1 |
| THANK YOU — (to resolve) | 3 | educational 1, upbeat 1, text reel 1 |

What the engine already does with these songs (93 cached runs): it proposes the chart half often
(Timeless 25 runs, Million Dollar Baby 24, Not Like Us 18) and the background-bed half almost never
(New Home, Mrs Magic, Karen 3, THANK YOU, Hotline Bling: 0 runs; Dark Red, Runaway: 1). Generation is
where the bed canon is lost, which is why generation goes first.

## 3. Treatments and sequence

| arm | what runs | cost |
|---|---|---|
| A, control | round 2, already running | 0 |
| B, generation only | candidates-v7 (shortlist in `safe`), scoring-v4 unchanged | ≈ $40, 1 h, both batches |
| C, generation + prior | B's cached verified candidates and component scores, plus `creator_prior` added **offline**, then diversify, then judge | judge calls only |

C costs no generation or scoring calls because the prior is a rule and `combine()` is pure. The offline
rescorer must supply every dimension explicitly (`combine` dereferences all of them). Explanations are
not regenerated for C; the judge does not see them (section 7).

Order: harness fixes (section 8) → data and mapping on the tune split → B on tune → C offline on tune →
freeze → one run of B and C on test → decide.

## 4. Data: `src/engine/catalog/creatorLists.ts`

Lives in `catalog/` because both candidates and scoring import it and catalog already owns song
identity (`normalize.ts`). It is a curated source, documented as such; the later automated version is an
adapter that writes `song_trend_signals` (source `manual`), not a copy of this shape.

```ts
export type ListType = "educational" | "emotional" | "sad" | "upbeat" | "day_in_life"
  | "storytelling" | "funny" | "motivational" | "text_reel";
export type ListSource = { id: "L1" | "L2" | "L3" | "L4" | "L5" | "L6"; handle: string; recorded: "2026-10-09" };
export type CreatorListEntry = {
  title_raw: string;            // as transcribed, with version words kept ("New Home (Slowed)")
  artist: string | null;        // null until resolved; never guessed
  deezer_id: string | null;     // null until resolved; lookups use this, never the title
  resolution_note: string | null;
  mentions: { source: ListSource["id"]; type: ListType }[];   // one per source per type
  banned_for_generation: boolean; // production-library stock (Kevin MacLeod): scored if verified, never offered
};
```

Derived helpers (pure, tested): `evidenceFor(deezerId, types: ListType[]) → { groups: number, matchedTypes }`
counting distinct sources whose type is in `types`; the offered shortlist for a clip (section 6).

Folding of one-off categories: inspiring → motivational; tactical → educational; deep → emotional;
6-second text reel → text_reel. Dropped as uncertain: challenge, energetic. Transcription conflicts in
the copied list (Loot/Lost, Tell Kim/Tell Em, Dem Guys/I Wanna Be Yours) are recorded as separate
unresolved entries with a note; they get no evidence until Dylan checks the video.

Resolution: ~50 titles have an obvious artist, ~25 do not. Each is searched on Deezer; anything with
more than one plausible recording stays unresolved and is listed for Dylan. Unresolved entries are never
offered and never scored.

## 5. Type mapping: `src/engine/catalog/listTypes.ts`

`listTypesFor(analysis, brief) → ListType[]`, pure, may return `[]`. First draft, to be checked against
the 63 tune analyses before anything else is built:

| type | rule |
|---|---|
| educational | content_category ∈ {education, business} |
| day_in_life | aesthetic or content_type contains "vlog", "day in the life", "routine" (case-folded) |
| storytelling | dialogue_present and the summary or story contains a first-person narrative marker ("I", "my", "we") and a temporal one ("when", "after", "years", "moved", "lost", "started"); abstain otherwise |
| emotional | mood ∩ {vulnerable, reflective, heartfelt, raw, honest, nostalgic, bittersweet, sentimental, emotional} and energy ≤ medium |
| sad | mood ∩ {sad, grief, heartbreak, melancholic, loss, mourning} |
| upbeat | energy ∈ {medium-high, high} and mood ∩ {fun, playful, happy, upbeat, positive, excited, celebratory, lighthearted} |
| motivational | mood ∩ {motivational, inspiring, determined, ambitious, triumphant, hopeful} |
| funny | content_category = comedy or mood ∩ {humorous, funny, comedic, silly} |
| text_reel | duration < 10 s and not dialogue_present and a moment of type text (needs the harness duration fix) |

The brief's requested feel wins over inferred mood: if `brief.fields.moods` names "upbeat" the clip
is upbeat even if the frames read quiet.

Acceptance is precision, not coverage: I hand-label the type(s) of 30 tune clips blind, run the rules,
and require precision ≥ 0.8 per type with at least 5 labelled positives; a type that cannot reach that
is switched off. Abstention is fine. The stored analyses are used read-only; nothing is tuned on test.

## 6. Treatment B: a shortlist in the `safe` prompt

In `buildCandidatePrompt`, direction `safe` only, when the clip has at least one type and someone is
talking (`dialogue_present`), append:

```
CREATOR PICKS
Creators who teach background music for Reels often use these under a talking <types> video:
- Dark Red — Steve Lacy
- ... (at most 8)
Include the ones that genuinely fit this video, with a truthful window; skip the rest. They count toward the 25.
```

Shortlist construction, deterministic: resolved, not banned, evidence for a matched type, ordered by
distinct groups then by title; cap 8; ties broken alphabetically so runs are reproducible. No new
direction, no change to `DirectionTag` or diversify. `PROMPT_VERSION` → `candidates-v7`.

Measured as a funnel per clip, stored in the run json: offered → generated → verified with sample →
in top 15 → in top 5. Plus: how many non-list songs that were in A's top 5 are displaced in B, and
whether the windows proposed for offered songs are plausible (spot check of 10 by ear, Dylan). Low
inclusion means inspection, not forced injection.

## 7. Treatment C: rule dimension `creator_prior`, weight 0.75, experimental

`src/engine/scoring/creatorPrior.ts`, shape of `overuse.ts`, lookup by `catalog_key`:

| case | score | reason (audit only, never shown) |
|---|---|---|
| not dialogue_present | 0.50 | "no speech: lists do not apply" |
| no listed song, or listed but not for this clip's types | 0.50 | "no matching creator evidence" |
| matched, 1 group | 0.80 | "1 creator list for educational" |
| matched, 2 groups | 0.90 | |
| matched, 3+ groups | 1.00 | |

`DIMENSIONS` gains `creator_prior`; `WEIGHTS` gains `creator_prior: 0.75` (Dylan's approval needed;
0 switches the prior off but, as Codex notes, does not undo treatment B). Effect: a 3-group matched
song gains 0.045 over an unlisted one and every pre-existing gap shrinks by 7.5/8.25, so gaps under
0.05 can flip and the artist-tolerance window widens slightly. That is the intended size: near-ties.

`explainPicks.topReasons` is changed to read `MODEL_DIMENSIONS` only, so neither this prior nor the
rule dimensions can displace a video-specific musical reason in the copy. `combine()` unchanged.
`docs/DATA_MODEL.md` lists the new key under `component_scores`. No migration (jsonb). Old rows keep
rendering (dash).

Not in C: no change to `STOCK_CHOICE_RULE`, `overuse.ts` or the scoring prompt. If round 3 shows
listed songs being generated, verified and then scored out by the stock rule on talking clips, that is
reported as a finding and the rule is revisited as its own experiment with its own prompt version.

## 8. Harness fixes before round 3

1. Pass the probed duration into the harness analysis (`scripts/groundtruth/ours.ts`), so
   `duration_seconds` is set as it is in production. Today it is missing on every stored analysis.
2. Speech on muted clips: for the clips where demucs produced a vocals stem, feed the vocals-only track
   to Whisper in the harness run instead of silence, so `dialogue_present` and the transcript come from
   the real speech. Where there is no stem, keep frame inference and record which path was used.
   Gemini's label stays as the independent check (83 of 93 agree today).
3. Judge v2, symmetric: both sides get title, artist, section start and end, and nothing else; the
   video description comes from our analysis only; Gemini's "why it works" and our explanation are
   removed. Shuffled A/B as before.
4. Paired comparison: `judge.ts --pair <tagA> <tagB>` judges rank 1 of two runs on the same clip, same
   symmetric inputs, shuffled. This is the primary metric.
5. Failed runs are counted in every denominator and reported, never dropped.

## 9. Decision rule

Measured on the 63 tune clips first; mapping, shortlist size and weight are frozen before the single
test run on 30 clips.

| metric | B vs A | C vs B |
|---|---|---|
| paired judge, primary | B wins − losses ≥ +7 clips of 63 on tune, and ≥ 0 on test | same |
| hit rate | not lower | not lower |
| funnel | reported | reported |
| sameness: most frequent song in top 5 across clips | not higher than A's (saman, 21 of 93) | same |
| listed share of top-5 picks | reported; soft ceiling 35 % | same |
| Dylan's 10-clip sheet, rerun | reported as smoke test | same |

Anything that misses the primary metric is reverted: B by returning the prompt to v6, C by removing
the dimension. A treatment that passes on tune and fails on test is reported as inconclusive and not
shipped. Changes are small; the point of the three arms is that we know which one did what.

Cost: harness fixes 1–2 h, data and mapping 2 h, B code and tests 1 h, C code and tests 1 h, round 3
≈ $40 plus judge calls, about 2 h wall-clock.

## 10. Questions for the reviewer, round 2

1. Treatment C evaluated offline from B's cached candidates: is reusing B's component scores a fair
   comparison, given scoring is a model call whose outputs would be identical anyway (same inputs)?
2. The storytelling rule abstains unless the summary has first-person and temporal markers. Too strict,
   or the right default for a type that otherwise swallows every narration clip?
3. The dialogue gate on the prior (0.5 for non-speech clips): the lists also tag upbeat and text-reel
   songs, which are usually non-speech. Accept the loss for week one?
4. Speech recovery via demucs vocals stems in the harness: any reason this is not closer to production
   than frame inference, given production hears the real audio?
5. The primary metric is a model judge with symmetric inputs. With one human and ten clips, is +7 net
   of 63 a reasonable bar, or should the bar be a share (for example 55 % of decided pairs)?
6. Anything in sections 4–7 that still crosses a stage boundary or writes a record the automated
   version would not?

## Appendix: the raw lists (Gemini transcription, 2026-10-09), by source group

- **L1 abigaildaniellla, "5 engaging songs"** (no categories): La Mudanza — Bad Bunny; Nissan Altima —
  Doechii; Love Like This — Faith Evans; Come Around and Love Me — Jalen Ngonda; Param-Pam-Pam — Carlos
  Campos.
- **L2 gobird**: storytelling: Oppenheimer, Good Man With a Broken Heart, Runaway (Kanye West).
  emotional: Mrs Magic (Strawberry Guy), Karen 3, New Home (Piano & Cello). educational: THANK YOU
  (The Creator), Dark Red (Steve Lacy), Money So Big. day in the life: Timeless (Instrumental),
  Everybody Wants To Rule The World, Paper Planes (M.I.A.).
- **L3 personalbrandlaunch "Background Music 101"**, also posted by real_domingo_/dexuscreative and
  largely by takase.exe; one group: educational: Not Like Us, Like That, Money So Big, 20 Min, Vampire
  Heart, Hell N Back. emotional / my story: Hotline Bling, Walking on a Dream, Gibran Alcocer, Low Key
  Gliding, Dark Red, Runaway. positive / upbeat: Thank You, Heart On My Sleeve, The Young Folks, 1901,
  Million Dollar Baby, Memory Reboot. day in the life: Dem Guys, Paper Planes, Surround Sound, Space
  Cadet, Loot, Tell Kim (the copy reads I Wanna Be Yours, Lost, Tell Em: unresolved conflicts). sad:
  New Home (Slowed), Another Love, Je Te Laisserai des Mots, Frank Saint, Home, Plage Coquillage.
- **L4 takase.exe, "Viral Music"** (counted as its own group only for songs not in L3): inspiring: A
  Good Man, Dragonfly, Freedom, Pink + White, Runaway. educational: Timeless, Not Like Us, Money So Big,
  20 Min, I Like The Way You Kiss Me. energetic (dropped): Vampire Heart, Tell Em, Sprinter, Million
  Dollar Baby, Like That. emotional: See You Again, Dark Red, Feeling Blue, I Was Only Temporary, Echo
  Sax End.
- **L5 martinwang**: emotional: Karen 3, New Home, Ylang Ylang. tactical / educational: ELBM, Dark Red,
  New Computers. challenge (dropped): CYHTM, Summer, Deep Space Samurai. storytelling: Skyfall, Missing
  Textures, Runaway. deep: Peer Pressure, Mrs Magic, Dimensions.
- **L6 kienobilfilms**: storytelling: 7 Years, Another Love, End of August. funny: Sneaky Snitch,
  Fluffing a Duck, Scheming Weasel (banned for generation). 6-second text reel: Eyes Without a Face,
  Dance (Instrumental), Thank You. motivational: Memory Reboot, Metamorphosis, Snowfall. emotional: Mrs
  Magic, In Love With Life, In This Shirt.
- personalbrandlaunch "The Power of Background Music": categories only, no songs.

Open question on grouping for Dylan: takase.exe shares 12 of 20 songs with L3, so I count it as an
independent group only for its 8 other songs. If you know these creators copy each other, say so and
the group counts drop further.
