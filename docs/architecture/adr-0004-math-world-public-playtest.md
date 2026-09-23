# ADR 0004: Publish the selected Math Worlds playtest behind a casual gate

Status: accepted, 22 September 2026.

## Decision

The product owner explicitly authorized public sharing of the selected
480-question, 20-world curriculum, content version
`spiral-20.v1.f665226c7060bba8`, and requested a simple password gate using
`hedgehog`, remembered in a cookie.

Commit this approved runtime and its 480 question-scoped images so ordinary
builds and GitHub Pages reproduce the complete adventure. The separate
reference plan records the approved content version and publication scope.
Future authoring exports remain local until separately approved. The broader
research corpus, source PDFs, private review records, and Catalogue QA workbench
remain outside the public site under ADR 0003.

The Math Worlds route initially shows the gate, including direct links and
`?qa=1` links. A correct password sets an access marker cookie for one year,
scoped to the Math Worlds route, with `SameSite=Lax` and `Secure` on HTTPS.
The cookie stores a marker rather than the password. Other Spatial Gym games
remain available without this gate. This is an explicit product exception to
the suite's default of no cookies.

This client-side gate is a casual playtest barrier, as requested. It does not
provide confidential storage or server-side authentication; the static source
and assets are public. The gate adds no backend, account, tracking, or remote
runtime dependency.
