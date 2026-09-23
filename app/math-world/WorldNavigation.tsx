"use client";

import { bossAfterWorld, canOpenBoss, type BossChallenge } from "./boss-challenges.ts";
import { canOpenWorld, type WorldProgress } from "./engine.ts";
import { WORLD_DEFINITIONS, WORLD_MODE, type WorldDefinition } from "./world-data.ts";
import styles from "./math-world.module.css";

type Destination = Readonly<{ kind: "world"; world: WorldDefinition }> | Readonly<{ kind: "boss"; challenge: BossChallenge }>;

const destinations: readonly Destination[] = WORLD_DEFINITIONS.flatMap((world): Destination[] => {
  const challenge = WORLD_MODE === "spiral-preview" ? bossAfterWorld(world.number) : undefined;
  return [{ kind: "world", world }, ...(challenge ? [{ kind: "boss" as const, challenge }] : [])];
});

const destinationId = (destination: Destination) => destination.kind === "world" ? destination.world.id : destination.challenge.id;

export function WorldNavigation({ selectedId, progress, qaUnlocked, busy = false, onChooseWorld, onChooseBoss }: Readonly<{
  selectedId: string;
  progress: WorldProgress;
  qaUnlocked: boolean;
  busy?: boolean;
  onChooseWorld: (worldId: string) => void;
  onChooseBoss: (challenge: BossChallenge) => void;
}>) {
  const index = destinations.findIndex(destination => destinationId(destination) === selectedId);
  const current = destinations[index];
  const previous = destinations[index - 1];
  const next = destinations[index + 1];
  const available = (destination: Destination | undefined) => !!destination && (destination.kind === "world"
    ? canOpenWorld(progress, destination.world.id, qaUnlocked)
    : canOpenBoss(progress, destination.challenge, qaUnlocked));
  function choose(destination: Destination | undefined) {
    if (!destination || busy || !available(destination)) return;
    if (destination.kind === "world") onChooseWorld(destination.world.id);
    else onChooseBoss(destination.challenge);
  }
  return <nav className={styles.worldNavigation} aria-label="World navigation">
    <div className={styles.worldPicker}>
      <button type="button" className={styles.worldArrow} aria-label="Previous world"
        disabled={busy || !available(previous)} onClick={() => choose(previous)}>←</button>
      <label className={styles.worldSelectLabel}>
        <span>Choose a world</span>
        <select aria-label="Choose a world" value={selectedId} disabled={busy}
          onChange={event => choose(destinations.find(destination => destinationId(destination) === event.target.value))}>
          {destinations.map(destination => {
            const unlocked = available(destination);
            if (destination.kind === "boss") return <option key={destination.challenge.id} value={destination.challenge.id} disabled={!unlocked}>
              ★ {destination.challenge.title} · After World {destination.challenge.afterWorld}{!unlocked ? " · Locked" : ""}
            </option>;
            const candidate = destination.world;
            const finished = candidate.stopIds.every(id => progress.completedStopIds.includes(id));
            return <option key={candidate.id} value={candidate.id} disabled={!unlocked}>
              {String(candidate.number).padStart(2, "0")} · {candidate.title} · {candidate.concept} {candidate.spiral}{finished ? " · ✓" : !unlocked ? " · Locked" : ""}
            </option>;
          })}
        </select>
      </label>
      <button type="button" className={styles.worldArrow} aria-label="Next world"
        disabled={busy || !available(next)} onClick={() => choose(next)}>→</button>
    </div>
    <span className={styles.worldSequence}>{current?.kind === "world"
      ? `World ${current.world.number} of ${WORLD_DEFINITIONS.length}`
      : current ? `Challenge after World ${current.challenge.afterWorld}` : ""}</span>
  </nav>;
}
