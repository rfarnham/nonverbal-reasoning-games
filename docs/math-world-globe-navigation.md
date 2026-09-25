# Math World globe navigation

The public spiral adventure uses one persistent Three.js globe for all 32 teaching archipelagos and the two boss placeholders. The existing authored island shapes, stop roads, and exactly two storybook islands per teaching world are projected onto fixed spherical regions. Concept-specific landmarks distinguish the destinations. Question content, ordering, scoring, saves, print workbooks, and the password gate retain their existing contracts.

## Player flow

- A new adventure opens on the globe. **Explore** brings its current archipelago into view. **Show globe**, dragging, and four native direction buttons let the player inspect the planet.
- Selecting a destination from the globe or the world list launches the same boat journey. Normal progression still controls which destinations are available. `testUser123` and `?qa=1` retain separate unrestricted playtest access.
- A boat travels through ocean waypoints, avoiding all archipelago regions. The camera follows its route and settles over the destination. **Skip voyage** arrives immediately; **Cancel voyage** and Escape return to the departure archipelago.
- Selecting a stop moves the animal along the actual road, adds a small bounce, and fades into the existing question panel. Finishing the stop returns to that archipelago. The child explicitly chooses the next stop.
- Teaching worlds and boss placeholders retain their original-art workbook buttons. Bosses stay separate from teaching questions and do not yet administer answers.

Destination selection is committed only on arrival. Canceling, closing the page, or reloading mid-voyage cannot unlock a destination, clear a stop, rewrite an answer, or lose already saved progress. Changing test mode discards an in-flight visual transition. Scrolling cancels positional stop animation, and leaving the page cancels travel. No transition awards XP or changes the curriculum.

## Rendering and accessibility

The globe, raised islands, paths, landmarks, and boat are local WebGL geometry. The animal is a camera-facing map pawn made from the bundled animal artwork, perched above its current stop or road so tall scenery cannot hide it. Stop and book controls are native HTML buttons projected from their actual 3D positions. They remain at least 44 CSS pixels; the ordered stop list provides an equivalent control route. The renderer releases its GPU, image, resize, visibility, and event resources on unmount.

## Geography and atmosphere

Each concept's archipelago has a geographic identity with a distinct return-visit variant. Terrain includes volcanic craters and basalt shores, dense forest canopies, coral lagoons, river valleys and waterfalls, snowy tundra, glacier fjords, alpine lakes, and desert formations. These are modeled landforms rather than recolored versions of one island. The original stop locations, roads, two storybooks, question order, and landing elevations stay consistent.

Soft cloud banks drift around the sphere, volcanoes emit rising smoke, water flows through rivers and falls, and the ocean has gentle moving highlights. Atmospheric haze softens the distant horizon. Clouds fade away from the focused archipelago so its stops remain readable.

**Pause scenery** freezes these environmental effects without interrupting navigation. Its preference is remembered on the device. System reduced motion keeps the scenery still and retains the existing direct navigation behavior. A separate active-time clock caps scenery painting at 30 frames per second, pauses while the page is hidden or the globe is offscreen, and avoids duplicating renders during camera travel. Returning to the map or tab resumes smoothly without jumping through elapsed hidden time. Question panels run none of these effects.

Reduced motion moves directly to the destination or question. If WebGL is unavailable or its context is lost, the authored map and native stop list remain playable. The globe adds no external runtime asset or service dependency.

## Arithmetic voyage extension

`voyage.ts` defines `ArchipelagoVoyage` and `VoyageActivityProps`. `GlobeBoard` accepts an optional `voyageActivity` component. When supplied, a journey pauses halfway and passes the departure, destination, and Continue/Cancel callbacks to that activity. Cancel and Skip safely resolve the pending activity before settling the journey.

No arithmetic questions, difficulty rules, timing, rewards, or gate have been invented. Those remain a separate product decision. With no activity supplied, the boat completes its journey without a mini game.

## Verification

Pure geometry tests cover fixed destinations, source-map projection, great-circle edge cases, all 561 destination pairs, ocean clearance, and consistent route sampling. Scenery-clock tests cover capped painting, pause/resume time, stalled frames, and disposal. Browser checks cover normal earned progression, test mode, cancellation and reload, same-canvas travel, stop completion, original-art workbook printing, boss milestones, context loss, reduced motion, remembered scenery pause, hidden/offscreen suspension, keyboard controls, and the 390/620/820/1440 layouts.
