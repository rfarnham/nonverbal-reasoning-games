# Spatial Gym avatar assets

These 12 colored animal avatars are locally bundled copies of the **Flat**
style from [Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji).
They were selected as a consistent, friendly collection and include the
Hedgehog avatar requested for Spatial Gym.

## Source

- Upstream repository: `microsoft/fluentui-emoji`
- Upstream commit: `62ecdc0d7ca5c6df32148c169556bc8d3782fca4`
- Source variant: each animal's `assets/<name>/Flat/*_flat.svg`
- Local changes: filenames were normalized; the SVG artwork itself is
  unmodified.
- License: MIT; see [LICENSE-MIT.txt](./LICENSE-MIT.txt).

The selected animals are Hedgehog, Fox, Rabbit Face, Panda, Owl, Penguin,
Frog, Monkey Face, Lion, Elephant, Turtle, and Unicorn.

## Why this set

The preferred Noun Project “Cute Animal” collection was investigated first.
Noun Project permits modification under the applicable CC BY license with
creator attribution, but its current free download flow provides black PNG
icons while SVG and full-set downloads are account/subscription-gated. It
therefore did not provide a reproducible source for locally bundled,
multi-color SVG derivatives. Fluent Emoji is an already-colored, coherent SVG
set with an explicit permissive license and no runtime network dependency.

`contact-sheet.html` provides a local visual inventory of the selected set.
