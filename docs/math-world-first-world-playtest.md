# Counting Coast visual playtest

The first world now uses an original, vibrant platform-adventure map: raised
islands, a continuous golden road, shallow optional branches, and a lighthouse
finish. Desktop and phone layouts have separate SVG compositions with the same
landmarks and stop order. Native numbered buttons sit over the illustration;
the expandable trail list provides another way to navigate.

This release is for **aesthetic and navigation approval**. It retains the
existing 38-question mixed pilot and its stable question/stop IDs. Four source-grounded OCR repairs remove corrupted wording and diagram punctuation; answers and ordering remain unchanged. It does not
claim that those questions implement Counting 1. The proposed concept-by-concept
replacement is in [the spiral curriculum outline](math-world-spiral-curriculum-proposal.md).
The outline is not imported into runtime or locked into progression.

## Playtest access

Open `/math-world/` while the selected local profile is named exactly
`testUser123`. A visible Test mode label confirms access. `/math-world/?qa=1`
is also available as a direct preview link.

- Every required trail and optional detour opens immediately.
- Selecting a trail starts a fresh attempt, including completed trails.
- Map returns from an unfinished attempt; selecting another trail replaces it.
- Reload resumes the current test attempt.
- Test progress is stored separately from ordinary world progress. No Journey
  progress, clear ledger, or XP is written.
- Switching or renaming the selected profile away from `testUser123` restores
  ordinary world progress. An explicit `?qa=1` link remains in test mode.
- Answers still require the canonical question and a solved full stop.
- Question feedback can be saved through Flag question and exported on the map.

The read-only bridge to the existing profile store is solely for recognizing
the selected test identity. It does not import a Journey attempt into Worlds.

## Review focus

Is the map a satisfying visual direction? Are the main road, destination,
optional detours, and current location immediately clear? Does the portrait map
feel like the same world? Test questions can reveal presentation issues, but
their current labels and ordering are not the proposed curriculum.

Once both the visual direction and the spiral outline are accepted, concept
banks can be inspected and assigned in parallel, then world maps can be produced
from the approved visual system. No additional world is generated in this step.

## Validation

Browser checks covered all nine required stops; a wrong answer and retry; full
finale completion; replay; normal locks; exact-profile auto-unlock; separate
saves; and live profile renaming from another tab. Desktop and 820, 620, and
390-pixel layouts have no horizontal overflow; map controls remain at least
44 pixels. Decorative art is hidden from assistive technology, and the map has
an ordered native-control equivalent. Reduced motion removes transitions.
