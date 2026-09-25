# Math World globe navigation

The public spiral adventure uses one persistent Three.js globe for all 32 teaching archipelagos and the two boss placeholders, grouped around six connected continental mainlands. The existing authored island shapes, stop roads, and exactly two storybook islands per teaching world are projected onto fixed spherical regions. Concept-specific landmarks distinguish the destinations. Question content, ordering, scoring, saves, print workbooks, and the password gate retain their existing contracts.

## Player flow

- A new adventure opens on the globe. **Explore** brings its current archipelago into view. **Show globe**, dragging, and four native direction buttons let the player inspect the planet.
- Selecting a destination from the globe or the world list launches the same boat journey. Normal progression still controls which destinations are available. `testUser123` and `?qa=1` retain separate unrestricted playtest access.
- A boat travels through ocean waypoints, avoiding all mainland and archipelago regions and polar ice. The camera follows its route and settles over the destination. **Skip voyage** arrives immediately; **Cancel voyage** and Escape return to the departure archipelago.
- Selecting a stop moves the animal along the actual road, adds a small bounce, and fades into the existing question panel. Finishing the stop returns to that archipelago. The child explicitly chooses the next stop.
- Teaching worlds and boss placeholders retain their original-art workbook buttons. Bosses stay separate from teaching questions and do not yet administer answers.

Destination selection is committed only on arrival. Canceling, closing the page, or reloading mid-voyage cannot unlock a destination, clear a stop, rewrite an answer, or lose already saved progress. Changing test mode discards an in-flight visual transition. Scrolling cancels positional stop animation, and leaving the page cancels travel. No transition awards XP or changes the curriculum.

## Rendering and accessibility

The globe, connected mainlands, raised islands, paths, landmarks, and boat are local WebGL geometry. The animal uses the bundled illustration as a camera-facing sprite: its feet meet the authored stop surface, with a contact shadow, and follow the bridge height while traveling. Its illustrated body stays readable against nearby canopies. The current stop pedestal disappears while the animal occupies it. Stop and book controls are native HTML buttons projected from their actual 3D anchors. Only the occupied stop badge moves below its anchor with a connecting stem, leaving the animal visible; it chooses a clear annotation lane near books and other stops. Crowded desktop captions move alongside their badge; redundant short labels are hidden on phones, while full accessible names and the ordered stop list remain available. They remain at least 44 CSS pixels; the ordered stop list provides an equivalent control route. The renderer releases its GPU, image, resize, visibility, and event resources on unmount. Immutable mainland CPU geometry is cached between map visits; each scene still owns and disposes its independent GPU resources.

## Geography and atmosphere

Each concept's archipelago has a geographic identity with a distinct return-visit variant. Terrain includes volcanic craters and basalt shores, dense forest canopies, coral lagoons, river valleys and waterfalls, snowy tundra, glacier fjords, alpine lakes, and desert formations. These are modeled landforms rather than recolored versions of one island. The original stop locations, roads, two storybooks, question order, and landing elevations stay consistent.

Six substantial, continuous mainland bodies give the destination clusters shared geography. Their different concave coastlines form peninsulas, broad bays, inland lakes, low coastal plains and interior ridges, with open seas between regions. Filled mainland polygons cover about 27% of the globe before adding the stop islands and polar caps. River valleys connect inland water to the coast. Heights near authored worlds stay below their islands, preserving stop and path visibility. Each archipelago retains a dominant landmark and smaller supporting terrain. Broad turquoise coastal shelves, reefs and animated foam connect the land to the sea. Rendering and route finding share the mainland authoring data: six conservative mainland envelopes join the 34 destination envelopes and two polar envelopes. Boat routes clear all 42 with room for the full hull.

The ocean samples seamless three-dimensional noise to form fine wind ripples and moving sun reflections; it has no latitude or longitude wave bands. One globe-local sun lights terrain, water, clouds, and smoke. Soft terrain shadows, cool night fill, a twilight terminator, distant haze, stars, and warm crater light give the globe a consistent sense of depth.

**Sky** offers Auto, Day, Sunset, and Night. Auto completes a cycle in six minutes of active scenery time. The three fixed choices position the sun relative to the inspected coast, so each effect can be explored immediately. Changing lighting never changes progression.

Billowing cumulus, broad stratus and feathered cirrus formations drift at different heights and velocities, gently deform and fade around the far limb. Shoreline wave bands advance toward the coast; trees sway from anchored roots with matching moving shadows; offshore ice drifts and bobs within its safe coastal envelope. Volcanoes emit smoke and embers, and local birds, spray, snow, fireflies, showers, rainbows, and auroras bring different regions to life. Effects use bounded geometry and share the same scenery clock. Clouds fade near the focused archipelago and all effects leave native stop controls accessible.

**Pause scenery** freezes these environmental effects without interrupting navigation. Its preference is remembered on the device. System reduced motion keeps the scenery still and retains the existing direct navigation behavior. A separate active-time clock caps scenery painting at 30 frames per second, pauses while the page is hidden or the globe is offscreen, and avoids duplicating renders during camera travel. Returning to the map or tab resumes smoothly without jumping through elapsed hidden time. Question panels run none of these effects.

Reduced motion moves directly to the destination or question. If WebGL is unavailable or its context is lost, the authored map and native stop list remain playable. The globe adds no external runtime asset or service dependency.

## Arithmetic voyage extension

`voyage.ts` defines `ArchipelagoVoyage` and `VoyageActivityProps`. `GlobeBoard` accepts an optional `voyageActivity` component. When supplied, a journey pauses halfway and passes the departure, destination, and Continue/Cancel callbacks to that activity. Cancel and Skip safely resolve the pending activity before settling the journey.

No arithmetic questions, difficulty rules, timing, rewards, or gate have been invented. Those remain a separate product decision. With no activity supplied, the boat completes its journey without a mini game.

## Verification

Pure geometry tests cover fixed destinations, source-map projection, real mainland coverage, coast concavity, inland water, rendered-geometry containment, exposed rivers, preserved stop elevations, great-circle edge cases, all 561 destination pairs, ocean clearance, and consistent route sampling. Motion tests verify fixed tree roots, bounded geometry, shared resource reuse and complete disposal. Sun-direction tests cover all lighting presets, polar focus, and a camera-independent automatic cycle. Scenery-clock tests cover capped painting, pause/resume time, stalled frames, and disposal. Browser checks cover normal earned progression, test mode, cancellation and reload, same-canvas travel, stop completion, original-art workbook printing, boss milestones, context loss, reduced motion, remembered scenery pause, hidden/offscreen suspension, keyboard controls, and the 390/620/820/1440 layouts.

The visual completion work and its acceptance evidence are tracked in [the durable completion plan](math-world-visual-completion-plan.md).
