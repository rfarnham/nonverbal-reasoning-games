# Math Kangaroo Journey selection

`selection-manifest.json` is the exact, deterministic 168-question source
selection for the six Journey boards from Junior I through Wizard II.
`runtime-manifest.json` is generated from it and contains only fields used by
the browser. Local corpus paths, private answer-key paths, crop coordinates,
review scores, and other build-only metadata are deliberately excluded from
the deployed client bundle.

- Each board has two disjoint 12-question stops followed by four unseen
  culmination questions.
- Junior I through Expert I use Cyprus grades 1-2.
- Expert II through Wizard II use Cyprus grades 3-4.
- Every selected item is Tier A in the visually reviewed private corpus and has
  been checked against the official Thales Cyprus answer-key PDF linked in its
  source record.
- `prompt` is a reviewed English transcription rendered as semantic HTML by
  the route, never baked into the public illustration.
- `choices[].displayText` is present on all five choices when a text, number,
  pair, or sequence answer row has been OCRed out of the source crop.
- `explanationPlan` contains a question-specific hint, at least two reviewed
  reasoning steps, and a grounded visual plan. The plan identifies real
  normalized regions or paths in the selected illustration, performs a causal
  trace/transform/compare/count action, and ends by revealing the answer
  verified against the official key.
- `asset.privateReportCrop` and PDF-point crop bounds are private build inputs.
  The ignored `work/` corpus, full papers, and private answer-key files are not
  published. A selected question-scoped illustration may be marked
  `release-ready` only after prompt text is removed, visual choices are
  relabelled 1-5 (or the semantic answer row is removed), the complete diagram
  remains intact, and the result receives manual visual QA.
- `asset-release-reviews.json` binds that manual approval to the exact decoded
  pixels of each reviewed WebP. Rebuilding or changing even one illustration
  invalidates its approval and returns it to the visual-QA queue.
- The selected Math Kangaroo illustration excerpts are included with
  authorization and are not covered by the repository’s MIT license.

After all reviewed overlay artifacts are complete, materialize them into the
browser corpus in this order:

```sh
~/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  scripts/merge-math-kangaroo-visual-explanations.py

~/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  scripts/build-math-kangaroo-selection.py
```

The merge rejects any unresolved geometry-rebase warning or coordinate basis
that does not match the current public asset. The selection build then copies
all 168 reviewed explanations into `selection-manifest.json`.

Regenerate the selected illustration candidates:

```sh
~/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  scripts/build-math-kangaroo-assets.py
```

Generate raw, level-scoped asset contact sheets and explanation-overlay sheets
from those exact candidates:

```sh
~/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  scripts/render-math-kangaroo-asset-contact-sheets.py

~/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  scripts/render-math-kangaroo-visual-overlay-audit.py \
  work/math-kangaroo-spatial-review/tmp/<reviewed-artifact>.json \
  work/math-kangaroo-spatial-review/tmp/<overlay-output>
```

After inspecting every rebuilt raw sheet, every overlay sheet, and any targeted
full-size assets, record the reviewed pixel digests explicitly, then rebuild
once more to apply the release gate:

```sh
~/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  scripts/record-math-kangaroo-asset-reviews.py --all --confirm-reviewed

~/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  scripts/build-math-kangaroo-assets.py
```

The private official answer-key PDFs must be present under
`work/math-kangaroo-spatial-review/originals/cyprus-official/answer-keys/`.

Finally generate the stripped browser manifest:

```sh
~/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  scripts/generate-math-kangaroo-runtime-manifest.mjs
```

The runtime generator rejects a missing grounded explanation or a final reveal
that disagrees with the official answer.
