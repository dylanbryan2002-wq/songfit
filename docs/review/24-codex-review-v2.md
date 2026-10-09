# Creator-list weighting v2 — Codex review, 2026-10-09

Verdict: generation-first approved in principle. Before round 3: freeze a comparable input/control
setup, resolve source counts, add the replay check. C stays offline pending Dylan's weight approval.

Critical findings: (1) changing analysis inputs for B invalidates cached A as control; (2) the duration
diagnosis was wrong: `fakeSubmission()` sets duration and `recommendSubmission()` enriches the analysis.

Q1 cached B scores fine for C, but replay must run combine → diversify → selectSections over all
verified candidates, with a prior-off replay check. Q2 pronoun test wrong; narrow narrative pattern;
precision needs predicted positives. Q3 accept speech gate; text-reel unreachable, drop it; baseline
weights when gate is false. Q4 demucs vocals can leak song lyrics; separate experiment. Q5 keep +7/63
net; ties, failures, uncertainty reported; positive test net wins required. Q6 recount groups (L3/L4
overlap), canonical display names, filter sample-less, "recommend" not "use", filter only
creator_prior from explanations, `song_trend_signals` adapter is lossy.

(Full text was pasted by Dylan in the engine session on 2026-10-09; this is the condensed record.)
