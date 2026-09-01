# #62 alt-text backfill report - 2026-08-30

Model: @cf/llava-hf/llava-1.5-7b-hf (Workers AI REST). Prompt: gallery one-sentence <=15w dense factual.
Corpus: 390 image docs (webp 338/jpeg 28/png 24). Targets: 293 (65 null-alt + 228 carrying the 25 measured >2-shared stamps, byte-exact em-dash values pulled from DB). Protected: 97 bespoke.

Runs (day-resumable, progress-file): calibrate 9 + 1 prior; run 177; run 104. Avg latency ~2.5s/call. Fallbacks: 0.
All captions <= 15 words (hard cap in script + audit overLen=0).

## AC verdicts
- AC1 stillEmpty=0 (mongosh-equivalent audit incl. null/missing/empty/trim) PASS
- AC2 overLen=0 (100% of 292 regenerated <=15w) PASS
- AC3 distinct alts 111 -> 348; zero of the 25 measured stamp values remain (58 ` - (gallery|hero|thumb)` regex hits are <=2-shared one-offs = PROTECTED per pinned >2 rule). Legit shared captions after: 4 values over 17 docs, ALL byte-identical duplicate frames (e.g. Copy of DSC_0555-* series, identical payloads) - LISTED per spec, not chased.
- AC4 protected docs never matched the rule; script only ever $set alt on target docs (97 bespoke untouched, incl. filename-as-alt docs Projects_*, Verti.png, ezgif.com-*)
- AC5 model info REST has no price field (derisk pass-3); REST/GraphQL expose no per-account neuron usage. Dashboard neuron reading PENDING from owner (expected within free tier or cents; ~305 calls).
- AC6 script + this report committed; /root/alt-progress.json removed post-completion.

## Residual targets
17 docs re-matching the rule do so ONLY because their regenerated captions equal identical-byte duplicates' captions. Re-running would regenerate identical captions on identical bytes (proven across Copy-of-DSC_0555-1/2/3). No action.
