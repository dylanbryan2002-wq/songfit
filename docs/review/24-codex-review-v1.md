# Creator-list weighting review — Codex, 2026-10-09 (on plan v1)

Recommendation: test resolved, bounded suggestions in the safe prompt first, with existing scoring unchanged. Then evaluate an explicit rule dimension on the same candidate pool. Do not ship the originality and overuse exemptions alongside the first experiment. The generation bottleneck supports retrieval assistance; these lists do not establish that listed songs are original, unsaturated, or better for every matching clip.

Reviewed current scoring, generation contracts, diversification, stored-score readers and the ground-truth harness. No implementation or paid evaluation run performed.

## Answers to the seven questions

### 1. Ship generation assistance first; prefer the explicit dimension over a forced cultural floor if a ranking prior helps.

**Important — §§4c–4f, 5.** Neither proposed scoring alternative should be the first intervention. Your measured problem is missing candidates. Start with resolved data, conservative mapping and a bounded safe-prompt shortlist. Preserve round-2 scoring. Next compare those same candidates with and without the rule prior, using cached component scores where possible.

The explicit dimension is easier to inspect and reverse than `cultural >= 0.8`. However, the alternative is not literally invisible: cultural scores/reasons are already stored; what is missing is causal attribution to the flag. Both approaches need a versioned data snapshot and experiment manifest.

Use three identifiable treatments: round-2 control, generation-only, generation-plus-prior. Study any stock-rule revision separately. Weight zero does **not** revert prompt injection, originality exemptions, overuse exemptions or explanation influence.

### 2. The 0.045 calculation is correct for equal-base candidates; the claimed total bound is not.

**Critical — §§4d, 6.** Current weights sum to 7.5. With the new term, `new = (7.5 × old + 0.75 × prior) / 8.25`. A matched 1.0 versus neutral 0.5 adds 0.04545 to the pairwise difference, while existing differences shrink by 7.5/8.25. It can reverse an old gap below 0.05. It cannot guarantee preservation of a human judgment of "clearly right."

Removing an originality cap of 0.3 can additionally add up to `0.7 × 0.75 / 8.25 ≈ 0.064`. Removing the overuse cap can also matter, though the two caps are not independent additive penalties. Prompt changes can move other model scores too. Thus 0.045 is not the combined intervention's bound.

Even a constant neutral score changes diversification: the fixed 0.1 artist tolerance now covers old-score gaps up to 0.11. Rank order among unlisted songs is unchanged, but final selections need not be.

Keep 0.5 neutral, including listed-but-type-mismatched songs; 0.6 rewards evidence that does not apply. Start with the proposed 0.75 only as a controlled experiment after Dylan approves it. Do not strengthen narration weighting yet. If the evidence is specifically background use, apply the uplift only for relevant music role and type; retain dialogue conflict scoring. Prefer a name such as `creator_prior` over `proven`.

### 3. Safe-prompt suggestions are the simplest route, but 80% inclusion is the wrong success gate.

**Important — §4c.** Multiple matched types can supply more than 25 songs, making 80% inclusion impossible. "Include every one that fits" also permits correct exclusion: forcing compliance can crowd out better choices or manufacture section claims.

Offer a small, deterministic shortlist—start with at most eight eligible recordings—and tell the model to choose only fitting ones. Do not introduce a fourth direction and its diversification consequences. Measure offered → generated → verified-with-sample → selected, plus section validity and displacement of good non-list picks. Low inclusion should trigger inspection, not automatic injection. Deterministic injection still needs truthful windows and cannot solve catalogue/sample failure.

Exclude unresolved and generation-banned entries from the offered set. Otherwise the Kevin MacLeod entries create contradictory instructions and contaminate inclusion statistics.

### 4. I found another stored-score reader, but no current old-row rejection path.

**Important — §4d.** `components/admin/CandidatesTable.tsx` reads stored scores and handles missing dimensions with a dash. `scripts/quality-run.ts` also reads them without exhaustive parsing. `explainPicks.topReasons` filters missing entries. I found no stored-row parse through `ScoredCandidate` in the searched application/scripts.

The premise about runtime exhaustiveness is wrong: `package.json` declares Zod `^3.25.76`; enum-keyed records become exhaustive in Zod 4. TypeScript's explicit `ComponentScores`/`WEIGHTS` records provide a different, compile-time guarantee. Keep runtime compatibility and add an old-row rendering check plus a new-score completeness check; do not upgrade Zod for this task.

Also, `combine()` dereferences every dimension directly. Any future cached-score rescoring must explicitly supply the new component before calling it.

### 5. Rules are appropriate this week; coverage quotas should not force classifications.

**Important — §4b.** Less than 10% unmatched and less than 60% per type are not measures of correctness. With 76 narration clips, a legitimate type might dominate. `story != null` can mean almost any narrative, not a storytelling format. Allow abstention; evaluate per-type precision and false positives on a development sample. Normalize case/phrases and explicitly handle absent duration; stored analysis alone may lack duration because `recommend.ts` enriches it from the submission.

Respect the creator's requested feel in `MusicBrief`, not only inferred mood. "Challenge → upbeat" is an assumption, not an equivalence. Keep uncertain mappings out until reviewed. No new model-produced `list_type` is necessary to test the prior.

### 6. Do not resolve the stock-rule conflict by asserting list membership beats it.

**Important — §4d.** A song can be recommended by educators and still be saturated or distracting under speech. Advice and overuse are different signals. Preserve both initially. If round-2 evidence independently shows the stock rule is too broad, revise that rule and bump its prompt version separately.

There is no honest prompt-free change to what the model understands. A deterministic postprocessing override is inspectable but still changes the meaning of originality. Avoid using a whitelist to declare a familiar choice original.

Keep the prior out of `topReasons`: a 1.0 prior would otherwise displace a video-specific musical reason, even when its weight is zero. The neutral reason "no creator-list signal" also fails the proposed no-"list" test. Evidence provenance belongs in audit data, not creator explanations.

### 7. The boundaries are workable, but provenance and identity need correction before coding.

**Important — §§4a, 4d.** The proposed row does not match `song_trend_signals`: the existing table has `song_id`, platform, popularity/growth/saturation, categories, timestamp and source—not title, artist, independent-list count and type evidence. Document this as a curated source with a future adapter, not a copy-ready table representation.

Store source/list-group IDs and each source's type assignment. A union of types plus total list count incorrectly turns one storytelling mention and three emotional mentions into four storytelling endorsements. Copies with conflicting transcriptions need reconciliation, not independent votes. Recording date is not publication date or proof of current popularity.

Use resolved Deezer IDs for scoring lookup. `normalizeKey` deliberately preserves recording distinctions; it does not make all suffixes irrelevant. Original, slowed, instrumental and piano/cello versions must not inherit each other's evidence automatically. Preserve raw title/version and resolution notes; ambiguous rows can have a null artist rather than a guessed required string.

Place shared evidence helpers outside the scoring stage's private config if generation consumes them. If evidence crosses a stage boundary as a new record, define its Zod contract in shared types; do not read tables inside stages. Document the component before use, obtain Dylan's weight/schema approval, and record scoring/data versions. No SQL migration is needed merely to add a JSON component key.

## Must fix in the evaluation plan

**Critical — §4f:** the harness analyses muted video (`scripts/groundtruth/ours.ts`), so it cannot hear narration. Validate `dialogue_present` and music-role labels against independent annotations before using narration results to justify narration-specific behavior. A frame-only inference is not equivalent to the live audio pipeline.

The current judge supplies our explanation but not an equivalent rationale for the real song, and includes Gemini's description of why the real soundtrack works. Shuffling A/B does not remove those asymmetries. Add a direct blinded round-2-versus-treatment comparison with equivalent information; use human listening for section/dialogue fit.

Freeze mappings, weights and thresholds on development clips before the final held-out run. Tuning on all 93 analyses and repeatedly making keep/revert decisions on the same test split weakens its held-out status. Ten human-rated clips provide a smoke test, not strong non-regression evidence; report paired wins/losses/ties and uncertainty, and count failed runs rather than dropping them.

Recompute comparable denominators: 4.2% was stated for all picks, not top-five picks. Seven of 62 unique tracks does not establish a 5–8 percentage-point ceiling on clip hit rate; count eligible matching clips. Track each song's frequency across clips: artist diversification within one result does not prevent everyone receiving Dark Red. Require a meaningful quality gain to justify added complexity; "nothing got worse" alone is insufficient.
