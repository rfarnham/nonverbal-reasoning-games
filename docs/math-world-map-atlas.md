# Math World map atlas

**Status:** researched geography patterns for the Math Kangaroo world system

**Rule:** borrow topology and pacing, never character art, level names, or
Nintendo's visual identity.

## Recommended hybrid

No single Mario map solves the whole curriculum. The reusable grammar should
combine:

1. an Odyssey-like atlas for choosing among many destinations;
2. a Wonder/Bowser's Fury-like illustrated local region;
3. an SMB3-like unmistakable required road made mostly of Math Kangaroo stops;
4. shallow Super Mario World-like branches for Turbo, minigames, review, or
   optional challenge; and
5. Tropical Freeze-like atlas → world detail nesting when the campaign becomes
   large.

The required path must always have a semantic ordered-list equivalent. Roads,
biomes, and animated bridges are orientation and reward; they are never the
only representation of prerequisites.

## Twelve map archetypes

| Archetype | Official reference | What it contributes | Math-world use |
| --- | --- | --- | --- |
| Gated landmark road | [Super Mario Bros. 3 manual](https://csassets.nintendo.com/noaext/image/private/t_KA_PDF/manual-wii_supermarioallstars?_a=BATCtdAA0) | Required action panels interspersed with houses, minigames, fortresses, and a finale | Clearest template for a required Math Kangaroo spine with occasional breaks |
| Contiguous atlas with shortcuts | [Super Mario World manual](https://www.nintendo.com/eu/media/downloads/games_8/emanuals/game_boy_advance_8/Manual_GameBoyAdvance_SuperMarioWorldSuperMarioAdvance2_EN_DE_FR_ES_IT.pdf) and [New Super Mario Bros. U Deluxe tips](https://play.nintendo.com/news-tips/tips-tricks/new-super-mario-bros-u-deluxe-tips-tricks/) | Cleared stages reveal roads and secret exits reveal alternate routes | One obvious curriculum road plus shallow practice and challenge branches |
| Radial kingdom | [Super Mario Bros. Wonder presentation](https://www.nintendo.com/au/news-and-articles/experience-the-unexpected-in-super-mario-bros-wonder-gameplay-presentation/) | Distinct worlds around a central Petal Isles hub, with some open-map areas | Stable realm landmarks around a mixed-reasoning or festival centre |
| Compact free-roam diorama | [Super Mario 3D World manual](https://csassets.nintendo.com/noaext/image/private/t_KA_PDF/manual-WiiU-Super_Mario_3D-World?_a=DATAg1AAZAA0) | Small world screens containing courses, castles, houses, and special activities | One compact chapter island where every nearby stop is visible at once |
| Nested atlas → island | [Donkey Kong Country: Tropical Freeze manual](https://www.nintendo.com/eu/media/downloads/games_8/emanuals/wii_u_6/donkey_kong_country__tropical_freeze/ElectronicManual_WiiU_DonkeyKongCountryTropicalFreeze_EN.pdf) | Global island selection followed by detailed island maps with open, locked, and cleared states | Best scaling pattern for thousands of questions: atlas → world → local route |
| Open archipelago with restoration | [Bowser's Fury official site](https://supermario3dworld.nintendo.com/bowsers-fury/) | Islands spread across a lake; landmarks reignite and terrain visibly clears | Solve a district cluster to relight a beacon, repair a bridge, or clear fog |
| Globe and postcard destinations | [Super Mario Odyssey kingdoms](https://supermario.nintendo.com/explore/) | Strongly differentiated kingdom silhouettes and travel between them | Top-level wrapper for a campaign whose every world can use different terrain |
| Observatory and galaxy clusters | [Super Mario Galaxy](https://www.nintendo.com/en-gb/Games/Nintendo-Switch-download-software/Super-Mario-Galaxy-2915395.html) and [Galaxy 2 manual](https://csassets.nintendo.com/noaext/image/private/t_KA_PDF/Wii_Super_Mario_Galaxy2_Eng?_a=DATAg1AAZAA0) | Hub domes and small galaxy clusters opened behind clear requirements | Constellation-like prerequisite or review clusters, with a linear list equivalent |
| Vertical geological layers | [Donkey Kong Bananza exploration](https://www.nintendo.com/en-ca/gaming-systems/switch-2/featured-games/donkey-kong-bananza/explore/) | Distinct underground strata and guardians that open the next layer | Revisit concepts at deeper stages without using Starter/Junior/Expert labels |
| Modular route-tile world | [Super Mario Maker 2 World Maker](https://supermariomaker.nintendo.com/news/super-mario-maker-2-april-2020-update/) | Panel-based paths that compose into many worlds | Data-driven templates—road, fork, ring, mountain, islands—over one renderer |
| Open quest planet | [Mario + Rabbids Sparks of Hope exploration](https://www.ubisoft.com/en-sg/game/mario-rabbids/sparks-of-hope/news-updates/2CI3jBnmNBTiq64vJkzPXr/mario-rabbids-sparks-of-hope-a-deep-dive-into-exploration) | Main adventure plus off-path characters, puzzles, passages, and environmental recovery | Required MK expedition with clearly optional Turbo and minigame encounters |
| Two-perspective diorama | [Yoshi's Crafted World](https://yoshiscraftedworld.nintendo.com/story/) | A stage can be revisited backward on a distinct Flip-Side | Review a familiar world using new representations or a reversed mixed route |

An additional restoration reference is [Paper Mario: Color
Splash](https://www.nintendo.com/en-gb/Games/Wii-U-games/Paper-Mario-Color-Splash-1090845.html),
where recovered stars reopen regions and the island visibly regains colour.

## Original geography rotation

The renderer should support a very different silhouette on every map without
changing stop semantics:

| Geography | Useful topology | Curriculum fit |
| --- | --- | --- |
| Meadow river delta | Several channels converge on a central town | Number joining/separating; mixed crossroads |
| Mountain switchbacks | One climbing road with overlook branches | Geometry depth; increasing conceptual stage |
| Island chain | Ferries and bridges between compact islands | Domain clusters; path counting; measurement |
| Underground strata | Vertical layers linked by caverns and lifts | Concepts revisited at deeper stages |
| City transit loop | Ring line with neighbourhood spurs | Order, intervals, time, transfer |
| Desert oasis ring | Caravan road around a central water source | Measurement, ratios, cyclic patterns |
| Sky constellation | Wind trails between floating islands | Patterns, prerequisites, coordinate reasoning |
| Forest canopy | Trunk elevators and looping branch paths | Recursion, branching possibilities, spatial view |
| Glacier fjords | Tunnels, ferries, and repaired ice causeways | Distance, shape, route constraints |
| Clockwork valley | Rail, aqueduct, and synchronized machinery | Patterns, equality, time, procedures |
| Deep-sea reef | Currents between shelves and research domes | Tiling, area, data, route reasoning |
| Festival/theatre tower | One compact map per floor | Mixed transfer and culmination worlds |
| Volcanic caldera | Ring path, rim branches, central synthesis | Fractions, cycles, transformation, culmination |
| Moon observatory | Craters connected as a sparse network | Coordinates, logic, upper-band abstraction |

## Responsive map rules

- Desktop may use a wide diorama; phone uses an authored portrait projection,
  not a shrunken desktop map.
- Stop controls remain native DOM buttons at least 44×44 CSS pixels.
- Focus order follows the curriculum path rather than screen coordinates.
- Required, current, completed, optional, and locked states use text and symbols
  as well as colour.
- One persistent **Continue adventure** action removes the need to visually
  search the illustration.
- No required panning, free movement, camera control, or hover-only label.
- Decorative route crossings do not imply prerequisite crossings.
- Reduced motion switches immediately to the final restored state.

## Stable visual grammar

World terrain can change completely, but stop meaning should not:

| Stop type | Stable treatment |
| --- | --- |
| Math Kangaroo | Realm-coloured circular marker with the realm icon |
| Current stop | Coral treatment, visible ring, `aria-current="step"` |
| Completed stop | Green check plus completed text |
| Turbo | Electric-bolt station on a shallow side branch |
| Minigame | Violet portal/star on a shallow side branch |
| Crossroads | Multi-realm bridge or junction |
| Culmination | Large lighthouse, castle, observatory, or central landmark |
| Locked | Muted marker plus locked text; never colour alone |

This grammar lets geography deliver novelty while navigation remains learned
once.

## Authoring model

Each world owns:

- an original SVG or layered raster composition;
- desktop and mobile normalized stop coordinates;
- one ordered list of required stop IDs;
- shallow optional branch references;
- realm and district references from `mk-map-ontology.v1`;
- restoration states tied to completed stop IDs; and
- no puzzle truth, answer keys, or mastery state.

Canvas is unnecessary for navigation. If later worlds need particles or dense
parallax, PixiJS can render a decorative layer underneath the same native DOM
controls.
