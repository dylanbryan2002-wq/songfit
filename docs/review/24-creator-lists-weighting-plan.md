# Plan: weighting songs from creator "background music" lists — review request

Status: proposal, nothing built. Written 2026-10-09 for a second opinion before coding.
Owner: Dylan. Author: Claude (engine session). Reviewer: Codex.

## 1. What the reviewer needs to know

Songfit takes a creator's Reel, analyses it, and returns song *sections* (song + start + end).
Engine stages, in order (`docs/ARCHITECTURE.md`):

| stage | file | what it does today |
|---|---|---|
| analysis | `src/analysis/` | frames + Whisper → `VideoAnalysis` (summary, content_category, mood[], energy, pacing, dialogue_present, important_moments) + `MusicBrief` |
| candidates | `src/engine/candidates/generateCandidates.ts` | three parallel model calls (directions `safe`, `current`, `unexpected`), 25 songs each, each with a proposed window; merged by `normalizeKey` |
| catalog | `src/engine/catalog/verifyCandidates.ts` | Deezer search; no 30 s sample → dropped |
| scoring | `src/engine/scoring/` | six model-scored dimensions in one batched call (`modelScores.ts`) + two rule dimensions (`dialogue.ts`, `overuse.ts`); `weights.ts` combines; every component score is stored on the candidate row (`component_scores` jsonb) |
| diversify | `src/engine/diversify/diversify.ts` | 15 picks, rank 1 = top total, then rotates directions; artist tolerance 0.1 |
| explain | `src/engine/explain/explainPicks.ts` | creator-facing copy; it reads the two highest-scoring component *reasons* per pick |

Rules that bind this plan (`CLAUDE.md`): weights live only in `weights.ts` and changing them needs
Dylan's OK; one file per scoring dimension returning `{ score: 0..1, reason }`; every component score is
stored; no stage reads another stage's table; model outputs parsed with Zod; `PROMPT_VERSION` bumped on
any prompt change; creators never see scores or jargon; manual-now, automated-later (a manual step writes
the same record the automated version will write).

Evaluation harness (`scripts/groundtruth/`, `docs/review/18`, `19`): 93 viral Reels screen-recorded by
Dylan, 66 with the real song identified (Gemini + ACRCloud fingerprint), run through the live engine
muted. Metrics: hit (real song in our 15), stage attribution for misses, a head-to-head model judge
(real song vs our rank 1, shuffled), Dylan's blind ratings, a held-out test split.
Round 1 baseline: 1 hit in 66; 27 of the first 30 misses were "never generated". Round 2 (candidates-v6,
scoring-v4) is running now and is the baseline this change must beat.

## 2. The new data

Dylan screen-recorded eight "background music for your videos" Reels and had Gemini transcribe them.
Six are independent lists (two are copies of the same list). 75 unique song titles, 127 mentions, each
tagged by the creator with a video type: educational, emotional, sad, upbeat/positive, day in the life,
storytelling, funny, motivational, plus one-offs (challenge, deep, inspiring, energetic, 6-second text
reel). Full data in the appendix.

Consensus (independent lists naming the song):

| song | lists | tagged for |
|---|---|---|
| Runaway — Kanye West | 4 | storytelling, emotional, inspiring |
| Dark Red — Steve Lacy | 4 | educational, emotional |
| Money So Big — Yeat | 3 | educational |
| New Home — Austin Farwell (slowed / piano & cello) | 3 | emotional, sad |
| Mrs Magic — Strawberry Guy | 3 | emotional, deep |
| THANK YOU — (artist to resolve) | 3 | educational, upbeat, 6-second text |
| twelve more | 2 | |

Two things about the nature of this data matter for the design:

1. These are explicitly **background music** lists. One creator says it outright: "this is not trending
   audios, this is actual music in the background of your video." So the lists describe the song under a
   talking creator, which is our main case: 76 of our 93 ground-truth clips have spoken dialogue.
2. It is **advice, not evidence**. Nobody measured performance. But the lists are themselves widely
   watched, so the songs on them are, by construction, what a creator in this niche would reach for.
   That is precisely the question our `cultural` dimension asks ("would this creator realistically use
   this song right now"). The right frame is a *prior on cultural fit*, not a quality signal.

## 3. What we measured before designing (no model calls, cached runs)

| measurement | result | implication |
|---|---|---|
| Ground-truth songs that are on these lists | 7 of 62 distinct songs, 2–3 of them loose title matches | The lists can raise the hit rate by at most ~5–8 points. They cannot fix it. We judge this change by blind ratings and the judge as much as by hits. |
| Runs in which the engine already proposed at least one list song | 57 of 93 | The engine knows the *chart* half of the canon: Timeless (25 runs), Million Dollar Baby (24), Not Like Us (18), I Like The Way You Kiss Me (14), Like That (10). |
| Consensus *bed* songs ever proposed | Dark Red 1, Runaway 1, Another Love 1, New Home 0, Mrs Magic 0, Karen 3 0, THANK YOU 0, Hotline Bling 0, Je te laisserai des mots 0 | The half of the canon that matters for talking-head clips is not being generated. Generation must change, not only scoring. |
| Runs with a list song in the top 5 / top 15 | 19 / 42 of 93; list songs are 4.2 % of all picks | Baseline for the over-recommendation guardrail. |

## 4. Proposal (recommended)

Four small pieces. Each is a pure function with its own test, and each can be switched off alone.

### 4a. Data file: `src/engine/scoring/config/creatorLists.ts`

Mirrors `config/overused.ts` (hand-maintained now, replaced by the `song_trend_signals` table later; the
row shape matches that table's columns so the migration is a copy, not a redesign):

```ts
export type ListType = "educational" | "emotional" | "sad" | "upbeat" | "day_in_life"
  | "storytelling" | "funny" | "motivational" | "text_reel";
export const CREATOR_LISTS: {
  title: string; artist: string; deezer_id: string | null;
  types: ListType[]; lists: number;      // independent lists naming it, and for which video types
  observed: "2026-10";                   // when the lists were recorded; decay later via song_trend_signals
}[] = [ ... ];
```

One-off creator categories fold into the nine: inspiring → motivational, energetic → upbeat,
challenge → upbeat, tactical → educational, deep → emotional, 6-second text reel → text_reel.

Resolution: about 50 titles have an obvious artist; about 25 do not (Karen 3, ELBM, CYHTM, Vampire
Heart, Low Key Gliding, Frank Saint, Plage Coquillage, Feeling Blue, Echo Sax End, Missing Textures,
Peer Pressure, Dimensions, New Computers, Deep Space Samurai, Dem Guys, Heart On My Sleeve, Dragonfly,
Freedom, Summer, Lost, Home, A Good Man, Oppenheimer, Dance, In Love With Life). Each is resolved by
Deezer search; a title with several plausible hits is left `deezer_id: null` and listed for Dylan to
confirm. Unresolved rows are excluded from matching, never guessed. Songs with no Deezer sample stay in
the file (the data is true) but can never be recommended (samples-only rule, unchanged).

### 4b. Type mapping: `src/engine/scoring/listTypes.ts`

`listTypesFor(analysis: VideoAnalysis): ListType[]`, pure, rule table over fields the analysis already
produces. A clip can match several types; it can match none.

| type | rule (first draft; the exact mood vocabularies are checked against the 93 stored analyses) |
|---|---|
| educational | content_category ∈ {education, business} |
| day_in_life | aesthetic or content_type mentions vlog / day in the life / routine |
| storytelling | dialogue_present and story ≠ null and content_category ∉ {education, business} |
| emotional | mood ∩ {vulnerable, reflective, heartfelt, raw, honest, nostalgic, bittersweet, sentimental} and energy ≤ medium |
| sad | mood ∩ {sad, grief, heartbreak, melancholic, loss, mourning} |
| upbeat | energy ∈ {medium-high, high} and mood ∩ {fun, playful, happy, upbeat, positive, excited, celebratory, lighthearted} |
| motivational | mood ∩ {motivational, inspiring, determined, ambitious, triumphant, hopeful} |
| funny | content_category = comedy or mood ∩ {humorous, funny, comedic, silly} |
| text_reel | duration < 10 s and not dialogue_present and an important_moment of type text |

Before coding the rest: run the mapping over the 93 stored analyses and print the distribution.
Acceptance: fewer than 10 % of clips match no type; no type matches more than 60 % of clips; a spot
check of 15 clips by eye agrees. If the vocabularies are too brittle, the fallback is to add a
`list_type` field to the analysis prompt, which is a Zod change on a table with rows and needs a
separate OK.

### 4c. Generation: put the matched list songs in front of the model

In `buildCandidatePrompt`, for direction `safe` only, append:

```
CREATOR LISTS
Creators who teach background music for Reels list these songs for <types> videos:
- Dark Red — Steve Lacy
- ...
Include every one of these that fits this video, with a real window and honest section_is_vocal;
they count toward the 25. Fill the rest with your own picks.
```

`safe` is already defined as "proven fits a creator in this niche has seen work many times", so this
is the direction's own brief made concrete. No new direction, no change to `DirectionTag` or diversify.
`PROMPT_VERSION` → `candidates-v7`. Nothing for clips that match no type.

Why not inject deterministically (skip the model)? Because a `GeneratedCandidate` needs a window,
anchor and `section_is_vocal`, and the model is what supplies those. The measured check is the
*inclusion rate*: of the list songs offered for a clip, how many come back in the `safe` list. If it is
under 80 % after round 3, the fallback is deterministic injection plus one small "choose windows for
these songs" call.

### 4d. Scoring: a rule dimension `proven` + weight 0.75

New file `src/engine/scoring/proven.ts`, same shape as `overuse.ts`:

| case | score | reason (written in creator-safe words, because `explainPicks` feeds the top two reasons to the copy model) |
|---|---|---|
| not on any list | 0.50 | "no creator-list signal" |
| on a list, but not for this video's types | 0.60 | "a creator go-to for other kinds of video" |
| on a list for a matching type, 1 list | 0.80 | "a creator go-to for storytelling videos" |
| 2 lists | 0.90 | same wording |
| 3+ lists | 1.00 | same wording |

Matching uses `normalizeKey(title, artist)` after verification (canonical names), exactly like
`overuse.ts`, so spelling variants and version suffixes do not matter.

Weight: add `proven: 0.75` to `WEIGHTS` (same as `originality`). `DIMENSIONS` gains `"proven"`.
Effect size, so the number is not arbitrary: total weight goes 7.5 → 8.25; a 3-list matched song gains
(1.0 − 0.5) × 0.75 / 8.25 ≈ **0.045** of total score over an unlisted song, which equals moving one
weight-1 dimension by 0.37. Diversify's artist tolerance is 0.1. So the prior reorders near-ties and
cannot carry a clearly wrong song past a clearly right one. 0.5 as the neutral value lowers every
unlisted song by the same constant, which changes no ranking among them; totals are never shown to
creators and have no threshold anywhere.

Reconciling with the existing rules, which currently say the opposite under dialogue:

- `modelScores.ts` `STOCK_CHOICE_RULE` (originality ≤ 0.3 for "a stock Reels choice", applied when
  dialogue is present) would punish Hotline Bling, Not Like Us or Another Love on a talking-head clip,
  which is exactly where the lists say creators use them. Fix: the scoring call gets one extra input
  field per candidate, `on_creator_lists: ["storytelling", "emotional"]` or `[]`, and the rule gains
  "except songs flagged on_creator_lists for one of this video's types; those are deliberate choices,
  not stock". `PROMPT_VERSION` → `scoring-v5`.
- `overuse.ts`: no song is on both lists today. Add the guard anyway: a song listed for a matching
  type is never scored as overused (evidence beats the hand list). One line, one test.

Schema and storage: `component_scores` is jsonb, so no migration. `docs/DATA_MODEL.md` candidates
row gains `proven` in the documented key list. `ScoredCandidate` uses `z.record(z.enum(DIMENSIONS), …)`
which is exhaustive over keys; grep shows no code parses stored rows back through it (the only reader
of `component_scores` outside scoring is `explainPicks.topReasons`, which indexes by `DIMENSIONS` and
already filters missing entries). Old rows therefore stay readable. `WEIGHTS` is `Record<Dimension,
number>`, so forgetting the weight is a type error, not a silent bug.

### 4e. Guardrail against sameness

The product is the fit and the section for *this* video, not the list. Measured after round 3:
list songs' share of all top-5 picks (baseline 4.2 %). Soft ceiling 35 %. If exceeded without a gain in
ratings, lower the weight to 0.5; if still exceeded, cap at two listed songs per batch of five in
diversify. Neither is built unless the number demands it.

### 4f. Measurement and the keep/revert rule

Run both batches under tag `round3` (same clips, same split), judge, rebuild reports, and compare
with round 2 on the held-out test split:

| metric | keep if |
|---|---|
| hit rate (test split) | not lower |
| judge prefers ours | not lower; and the split by music role (narration vs amplify) does not get worse on narration clips |
| Dylan's blind ratings on the 10-clip sheet, rerun on round-3 picks | "good" share not lower |
| list inclusion rate (4c) | ≥ 80 %, else fallback |
| list share of top 5 | ≤ 35 % |

Any "lower" on the first three → revert the weight to 0 (one line) and keep the data file; the
prompt injection is judged on its own by the same table.

Cost: data and mapping ≈ 2 h of work, code + tests ≈ 2 h, round 3 ≈ $40 and ~1 h with two workers.

## 5. Simpler alternative (half the work, not auditable)

Do 4a, 4b and 4c, and instead of a dimension pass the `on_creator_lists` flag to the scorer with the
rule "cultural ≥ 0.8 and not stock for a listed song whose type matches". No weights change, no
`DIMENSIONS` change. Downside: the lift is whatever the model decides, it is invisible on the candidate
row, and it cannot be switched off or tuned without a prompt change. I recommend the dimension because
"we need to get this right" means being able to see what it did on every row.

## 6. Risks

- **Sameness.** Everyone gets Dark Red. Covered by 4e and by diversify's artist rule.
- **Staleness.** These lists reflect 2024–2025 taste; the `observed` field exists so the later
  `song_trend_signals` version can decay them. No decay now.
- **Mapping brittleness.** Mood vocabularies are free strings from our analysis model. Covered by the
  distribution check in 4b before anything else is built; the honest fallback is a schema change.
- **Double counting.** The model's `cultural` score may already reward famous songs; the dimension
  adds on top. The 0.045 effect size is the bound on the damage, and round 3 measures it.
- **Leaking jargon.** `explainPicks` reads component reasons. Reason strings are written in plain
  creator language from the start; a test asserts no reason contains "list", "score" or "lists".
- **Royalty-free entries.** Sneaky Snitch, Fluffing a Duck, Scheming Weasel (Kevin MacLeod) are on a
  list and the candidates prompt bans "production-library stock music". The ban stays for generation;
  if Deezer has a sample they can still be scored like anything else. Low stakes: funny clips are rare
  in our niche.
- **Low ceiling.** 7 of 62 ground-truth songs are on the lists. This change is about making talking-head
  recommendations look like what creators actually do, not about the hit-rate headline. Section 3 says
  so up front so nobody reads round 3 as a failure if hits stay flat and ratings rise.

## 7. Questions for the reviewer

1. Dimension with a fixed weight (4d) versus the scorer-flag-only alternative (5): which would you ship
   first, given we can run the full eval in an hour?
2. Neutral value 0.5 and weight 0.75: is the 0.045 effect size the right order of magnitude, or should
   the prior be stronger for narration clips (where the lists are most relevant) and weaker when no one
   is talking?
3. Injecting into the `safe` direction (4c) versus a fourth direction versus deterministic injection:
   any reason the prompt route will fail that the inclusion-rate check would not catch?
4. The exhaustive `z.record(z.enum(DIMENSIONS))` on `ScoredCandidate`: do you see a reader of stored
   `component_scores` I missed that would now reject old rows?
5. The type mapping (4b) as rules over mood strings: acceptable for a week-one prior, or should the
   analysis model emit `list_type` directly even though that touches a schema with rows?
6. Resolving the `STOCK_CHOICE_RULE` conflict by a per-candidate flag in the scoring prompt: cleaner
   way to say "evidence beats the hand rule" without a prompt change?
7. Anything here that violates the architecture rules (stage boundaries, typed records, weights only
   in `weights.ts`, Zod on every model output)?

## Appendix: the raw lists (as transcribed by Gemini, 2026-10-09)

- **personalbrandlaunch, "The Power of Background Music"**: categories only (educational, day in the
  life/vlogs, emotional, sad, upbeat/positive), no song names.
- **abigaildaniellla, "5 engaging songs"** (no categories): La Mudanza — Bad Bunny; Nissan Altima —
  Doechii; Love Like This — Faith Evans; Come Around and Love Me — Jalen Ngonda; Param-Pam-Pam — Carlos
  Campos.
- **gobird**: storytelling: Oppenheimer, Good Man With a Broken Heart, Runaway (Kanye West).
  emotional: Mrs Magic (Strawberry Guy), Karen 3, New Home (Piano & Cello). educational: THANK YOU
  (The Creator), Dark Red (Steve Lacy), Money So Big. day in the life: Timeless (Instrumental),
  Everybody Wants To Rule The World, Paper Planes (M.I.A.).
- **personalbrandlaunch, "Background Music 101"** and **real_domingo_ / dexuscreative** (same list;
  counted once): educational: Not Like Us, Like That, Money So Big, 20 Min, Vampire Heart, Hell N Back.
  emotional / my story: Hotline Bling, Walking on a Dream, Gibran Alcocer, Low Key Gliding, Dark Red,
  Runaway. positive / upbeat: Thank You, Heart On My Sleeve, The Young Folks, 1901, Million Dollar Baby,
  Memory Reboot. day in the life: Dem Guys, Paper Planes, Surround Sound, Space Cadet, Loot, Tell Kim
  (the copy reads I Wanna Be Yours, Lost, Tell Em for the last three). sad: New Home (Slowed), Another
  Love, Je Te Laisserai des Mots, Frank Saint, Home, Plage Coquillage.
- **takase.exe, "Viral Music"**: inspiring: A Good Man, Dragonfly, Freedom, Pink + White, Runaway.
  educational: Timeless, Not Like Us, Money So Big, 20 Min, I Like The Way You Kiss Me. energetic:
  Vampire Heart, Tell Em, Sprinter, Million Dollar Baby, Like That. emotional: See You Again, Dark Red,
  Feeling Blue, I Was Only Temporary, Echo Sax End.
- **martinwang, "Background Music for short form"**: emotional: Karen 3, New Home, Ylang Ylang.
  tactical / educational: ELBM, Dark Red, New Computers. challenge: CYHTM, Summer, Deep Space Samurai.
  storytelling: Skyfall, Missing Textures, Runaway. deep: Peer Pressure, Mrs Magic, Dimensions.
- **kienobilfilms, "Background Music for reel"**: storytelling: 7 Years, Another Love, End of August.
  funny: Sneaky Snitch, Fluffing a Duck, Scheming Weasel. 6-second text reel: Eyes Without a Face,
  Dance (Instrumental), Thank You. motivational: Memory Reboot, Metamorphosis, Snowfall. emotional:
  Mrs Magic, In Love With Life, In This Shirt.
