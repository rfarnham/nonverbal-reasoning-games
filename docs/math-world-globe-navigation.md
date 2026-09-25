# Math World globe navigation

The public spiral adventure uses one persistent Three.js globe for all 32 teaching archipelagos and the two boss placeholders. The existing authored island shapes, stop roads, and exactly two storybook islands per teaching world are projected onto fixed spherical regions. Concept-specific landmarks distinguish the destinations. Question content, ordering, scoring, saves, print workbooks, and the password gate retain their existing contracts.

## Player flow

- A new adventure opens on the globe. **Explore** brings its current archipelago into view. **Show globe**, dragging, and four native direction buttons let the player inspect the planet.
- Selecting a destination from the globe or the world list launches the same boat journey. Normal progression still controls which destinations are available. `testUser123` and `?qa=1` retain separate unrestricted playtest access.
- A boat travels through ocean waypoints, avoiding all archipelago regions and polar ice. The camera follows its route and settles over the destination. **Skip voyage** arrives immediately; **Cancel voyage** and Escape return to the departure archipelago.
- Selecting a stop moves the animal along the actual road, adds a small bounce, and fades into the existing question panel. Finishing the stop returns to that archipelago. The child explicitly chooses the next stop.
- Teaching worlds and boss placeholders retain their original-art workbook buttons. Bosses stay separate from teaching questions and do not yet administer answers.

Destination selection is committed only on arrival. Canceling, closing the page, or reloading mid-voyage cannot unlock a destination, clear a stop, rewrite an answer, or lose already saved progress. Changing test mode discards an in-flight visual transition. Scrolling cancels positional stop animation, and leaving the page cancels travel. No transition awards XP or changes the curriculum.

## Rendering and accessibility

The globe, raised islands, paths, landmarks, and boat are local WebGL geometry. The animal is a camera-facing map pawn made from the bundled animal artwork, perched above its current stop or road so tall scenery cannot hide it. Stop and book controls are native HTML buttons projected from their actual 3D positions. They remain at least 44 CSS pixels; the ordered stop list provides an equivalent control route. The renderer releases its GPU, image, resize, visibility, and event resources on unmount.

## Geography and atmosphere

Each concept's archipelago has a geographic identity with a distinct return-visit variant. Terrain includes volcanic craters and basalt shores, dense forest canopies, coral lagoons, river valleys and waterfalls, snowy tundra, glacier fjords, alpine lakes, and desert formations. These are modeled landforms rather than recolored versions of one island. The original stop locations, roads, two storybooks, question order, and landing elevations stay consistent.

The destinations form six authored geographic clusters with open channels, larger stretches of ocean, and irregular polar ice caps. Each archipelago has a dominant landmark and smaller supporting terrain. Coastal shelves, reefs, and broken foam connect the islands to the sea. Polar ice and all island envelopes also participate in boat route finding.

The ocean samples seamless three-dimensional noise to form fine wind ripples and moving sun reflections; it has no latitude or longitude wave bands. One globe-local sun lights terrain, water, clouds, and smoke. Soft terrain shadows, cool night fill, a twilight terminator, distant haze, stars, and warm crater light give the globe a consistent sense of depth.

**Sky** offers Auto, Day, Sunset, and Night. Auto completes a cycle in six minutes of active scenery time. The three fixed choices position the sun relative to the inspected coast, so each effect can be explored immediately. Changing lighting never changes progression.

Cloud banks drift and gently deform, volcanoes emit smoke and embers, and local birds, spray, snow, fireflies, showers, rainbows, and auroras bring different regions to life. Effects use bounded geometry and share the same scenery clock. Clouds fade near the focused archipelago and all effects leave native stop controls accessible.

**Pause scenery** freezes these environmental effects without interrupting navigation. Its preference is remembered on the device. System reduced motion keeps the scenery still and retains the existing direct navigation behavior. A separate active-time clock caps scenery painting at 30 frames per second, pauses while the page is hidden or the globe is offscreen, and avoids duplicating renders during camera travel. Returning to the map or tab resumes smoothly without jumping through elapsed hidden time. Question panels run none of these effects.

Reduced motion moves directly to the destination or question. If WebGL is unavailable or its context is lost, the authored map and native stop list remain playable. The globe adds no external runtime asset or service dependency.

## Arithmetic voyage extension

`voyage.ts` defines `ArchipelagoVoyage` and `VoyageActivityProps`. `GlobeBoard` accepts an optional `voyageActivity` component. When supplied, a journey pauses halfway and passes the departure, destination, and Continue/Cancel callbacks to that activity. Cancel and Skip safely resolve the pending activity before settling the journey.

No arithmetic questions, difficulty rules, timing, rewards, or gate have been invented. Those remain a separate product decision. With no activity supplied, the boat completes its journey without a mini game.

## Verification

Pure geometry tests cover fixed destinations, source-map projection, great-circle edge cases, all 561 destination pairs, ocean clearance, and consistent route sampling. Sun-direction tests cover all lighting presets, polar focus, and a camera-independent automatic cycle. Scenery-clock tests cover capped painting, pause/resume time, stalled frames, and disposal. Browser checks cover normal earned progression, test mode, cancellation and reload, same-canvas travel, stop completion, original-art workbook printing, boss milestones, context loss, reduced motion, remembered scenery pause, hidden/offscreen suspension, keyboard controls, and the 390/620/820/1440 layouts.
