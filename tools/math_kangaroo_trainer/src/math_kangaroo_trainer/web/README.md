# Private Stage 0 reviewer UI

This directory contains the dependency-free, same-origin frontend for the
private Math Kangaroo Stage 0 evidence review. The local reviewer server should
serve these files only on its fixed localhost listener. They are not public-site
assets and must not be copied into the learner application or a static export.

The UI deliberately:

- identifies this session's configured **Reviewer slot 1 or 2** and requires a
  different person to complete the other slot independently;
- loads summary lists first, then only one question or duplicate group detail
  at a time;
- never requests a bulk payload of private question records;
- never renders arbitrary filesystem paths or raw JSON;
- accepts crop, source-PDF, and answer-key evidence only from the same origin;
- displays only an allowlist of normalized source and progress fields;
- keeps protected answer evidence visibly separate from parsed learner content;
- records five explicit evidence checks for every question; and
- treats unavailable solutions, OCR confidence, and published point tiers as
  content gaps that reviewers must not invent.

The skill ontology is a later, read-only Stage 0 approval gate. It is described
in the overview and status views but is not editable here.

The frontend uses only `index.html`, `reviewer.css`, `reviewer.js`, and
browser-native APIs. It has no external fonts, scripts, images, analytics, or
runtime network dependencies.

## Same-origin API contract

The frontend calls exactly these collection and progress endpoints:

```text
GET /api/progress
GET /api/items
GET /api/duplicates
```

The two collection endpoints return ordered **summary lists**, not full item
records. Every item summary supplies an `item_id`; every duplicate summary
supplies a `group_id`. A summary may include the active reviewer's saved state
so the jump list can mark completed positions. `/api/progress` supplies the
active reviewer's counts and optional current IDs. It must identify the session
as reviewer slot `1` or `2`.

One flat normalized item is loaded and saved by stable ID:

```text
GET  /api/items/{item_id}
POST /api/items/{item_id}
```

The item detail includes:

- `item_id`, `stem`, and ordered `choices`;
- `official_answer` and/or a `protected_answer` record;
- an allowlisted `source_metadata` record;
- `warnings` and `gaps` (or their corresponding code arrays);
- the active reviewer's `current_review`, if one exists; and
- optional `navigation` with adjacent stable IDs.

Question-scoped evidence is served from these exact same-origin routes:

```text
GET /api/items/{item_id}/asset
GET /api/items/{item_id}/source-pdf
GET /api/items/{item_id}/answer-key
```

The detail response may provide equivalent same-origin URL fields. When it does
not, the frontend derives the three routes above from `item_id`. An optional
explicit HTTP(S) source-page URL may also be shown. Local `file:` paths and
cross-origin asset, PDF, or answer-key URLs are rejected by the frontend.

The item POST body contains exactly the five booleans below plus `disposition`
and `notes`:

```json
{
  "question_boundary_verified": true,
  "choices_verified": true,
  "answer_key_verified": true,
  "diagram_verified": true,
  "source_metadata_verified": true,
  "disposition": "faithful",
  "notes": ""
}
```

`disposition` is `faithful`, `needs_review`, or `rejected`. The frontend will
not save `faithful` unless all five checks are true.

One duplicate group is loaded and saved by stable ID:

```text
GET  /api/duplicates/{group_id}
POST /api/duplicates/{group_id}
```

The flat duplicate detail includes `group_id`, `signature_type`, `signature`,
two or more normalized `members`, the active reviewer's `current_review`, and
optional `navigation`. Its POST body is:

```json
{
  "decision": "confirmed",
  "notes": ""
}
```

`decision` is `confirmed`, `rejected`, or `needs_review`.

Every API response must be scoped to the configured reviewer slot. It must
never return the other reviewer's decision, notes, identity, or completion
state: seeing those would compromise the required independent review.
