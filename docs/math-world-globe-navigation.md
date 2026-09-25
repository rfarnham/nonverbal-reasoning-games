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

The globe, raised islands, paths, landmarks, and boat are local WebGL geometry. The animal is a camera-facing sprite made from the bundled animal artwork. Stop and book controls are native HTML buttons projected from their actual 3D positions. They remain at least 44 CSS pixels; the ordered stop list provides an equivalent control route. The renderer only draws during a change and releases its GPU, image, resize, and event resources on unmount.

Reduced motion moves directly to the destination or question. If WebGL is unavailable or its context is lost, the authored map and native stop list remain playable. The globe adds no external runtime asset or service dependency.

## Arithmetic voyage extension

`voyage.ts` defines `ArchipelagoVoyage` and `VoyageActivityProps`. `GlobeBoard` accepts an optional `voyageActivity` component. When supplied, a journey pauses halfway and passes the departure, destination, and Continue/Cancel callbacks to that activity. Cancel and Skip safely resolve the pending activity before settling the journey.

No arithmetic questions, difficulty rules, timing, rewards, or gate have been invented. Those remain a separate product decision. With no activity supplied, the boat completes its journey without a mini game.

## Verification

Pure geometry tests cover fixed destinations, source-map projection, great-circle edge cases, all 561 destination pairs, ocean clearance, and consistent route sampling. Browser checks cover normal earned progression, test mode, cancellation and reload, same-canvas travel, stop completion, original-art workbook printing, boss milestones, context loss, reduced motion, keyboard controls, and the 390/620/820/1440 layouts.
