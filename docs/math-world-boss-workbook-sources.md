# Boss challenge print sources

The two Grades 1–2 assessment workbooks retain the full USA tests in original
question order, separately from the 480 teaching questions. The 2025 challenge
follows World 10; the 2026 challenge follows World 20. This manifest publishes
only these selected tests, not the private source corpus, solutions or answer
keys.

`app/math-world/boss-workbook-assets.json` pins every published image by SHA-256,
pixel dimensions, source capture and question numbers. Question text, diagrams
and the original A–E options are all image content; no OCR or rebuilt answer
buttons appear in either workbook.

## 2025 original paper

Six original paper pages, rendered at 200 dpi from
`2025-questions-grades-1-2.pdf`. All 24 questions and the printed copyright remain.
The personal top margin was omitted: 80 pixels on page 1 and 120 pixels on pages
2–6, where the personalized line overlapped the repeated running header. No
question content occupies those bands. No central watermark was removed.

Page membership is 1–2, 3–7, 8–11, 12–15, 16–20, and 21–24. These six page images
print as six pages, preserving the original test presentation.

## 2026 original question slides

Twenty-four original question frames, captured at 0.5 seconds from the official
USA solution videos. Only the question presentation is used; no explanation,
annotation or answer key is published. Each question has its own workbook page
with pencil working space. Source video hashes and original crop bounds remain
in the manifest.

Visual review found that the existing staging crop of Question 21 ended at
699 pixels and clipped choice E. Its published crop was re-extracted from the
same original 1280 × 720 video frame using `[75, 0, 1280, 720]`. This preserves the
entire original choice E and the copyright at lower right. No question text was
reconstructed to repair the crop.

## Print behavior

The print window opens directly from the button gesture, prepares every image,
verifies dimensions and page fit, then enables printing. Popup blocking, missing
or changed images and early window closure are handled without changing world
progress. All assets use the site's base path and load from the same origin.
