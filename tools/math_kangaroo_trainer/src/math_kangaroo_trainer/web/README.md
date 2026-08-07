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

## Complete-corpus Catalogue QA

`catalogue.html`, `catalogue.css`, and `catalogue.js` are a separate teacher
workbench served by `catalogue review-web`. It does not replace or enlarge the
Stage 0 gold sample. Its loopback API is namespaced below `/api/catalogue/` and
provides summary-only pagination plus one lazy private item detail at a time.

The principal routes are:

```text
GET  /api/catalogue/summary
GET  /api/catalogue/items
GET  /api/catalogue/items/{item_id}
PUT  /api/catalogue/items/{item_id}/review
GET  /api/catalogue/taxonomy
PUT  /api/catalogue/taxonomy/skills/{skill_id}/review
GET  /api/catalogue/items/{item_id}/neighbors
PUT  /api/catalogue/items/{item_id}/neighbors/{neighbor_id}/review
GET  /api/catalogue/map?view={surface|tag|hybrid}&item_id={optional_stable_id}
POST /api/catalogue/explore
POST /api/catalogue/recommendations/preview
GET  /api/catalogue/export
```

The Problem Space explorer requests a compact, content-minimized two-dimensional
projection from `map`. Every mapped point supplies a stable item ID, finite `x`
and `y` coordinates, grade band, published point tier, primary domain, question
type, and optional cluster and review/proposal state. A tagless item is returned
as explicitly unmapped in Proposed taxonomy view rather than placed at a fake
origin. The response identifies its actual projection method, version, measured
neighbor preservation, and non-authoritative cluster evidence; the UI does not
infer or rename the method.

Arbitrary pasted question text is sent only in the JSON body of `explore`:

```json
{ "query": "question ID or pasted text", "view": "hybrid", "limit": 8 }
```

It is never put into the address bar, browser history, or a GET query. `explore`
returns a short ranked candidate list with bounded prompt excerpts, allowlisted
source labels, ranking components, and classification provenance so the teacher
can disambiguate without loading the whole corpus. Exact IDs resolve through
the same POST contract. Tag-only pasted-text queries are unavailable because
text has no proposal-tag vector; Hybrid renormalizes over its available Surface
evidence. Walking from a resolved question reuses the existing item-neighbor
route. Unsupported or low-signal pasted text returns no confident matches.

Question, neighbor, and skill judgements use optimistic `If-Match` revisions
and append-only history. The export uses an explicit allowlist and contains no
prompt, choice, answer, asset, URL, or filesystem-path fields. Similarity and
recommendation responses are labelled experimental; they cannot approve an
ontology, infer mastery, or authorize public release. Recommendation evidence
separately identifies a machine proposal, a teacher classification, and an
explicit curriculum approval; deterministic rank scores are not reported as
selection probabilities.
