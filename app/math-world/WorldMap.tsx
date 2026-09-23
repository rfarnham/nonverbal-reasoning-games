"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/progression/avatar";
import {
  QUESTIONS_BY_STOP,
  WORLD_DEFINITIONS,
  stopsForWorld,
  breaksForWorld,
  type BreakStop,
  type MathStop,
  type WorldStop,
  type WorldDefinition,
} from "./world-data.ts";
import {
  canOpenRequiredStop,
  canOpenWorld,
  nextRequiredStopId,
  stopFirstTryAccuracy,
  type WorldProgress,
} from "./engine.ts";
import styles from "./math-world.module.css";
import CoastScene from "./CoastScene";
import { useMapTravel } from "./useMapTravel";
import { printWorldWorkbook } from "./workbook";

type MapProps = Readonly<{
  progress: WorldProgress;
  world: WorldDefinition;
  onChooseWorld: (worldId: string) => void;
  qaUnlocked: boolean;
  avatarStopId: string | null;
  onOpenStop: (stopId: string) => void;
  onInspectStop: (stopId: string) => void;
  onExportQa: () => void;
}>;

function stopStyle(stop: WorldStop): CSSProperties {
  return {
    "--stop-x": `${stop.x}%`,
    "--stop-y": `${stop.y}%`,
    "--mobile-stop-x": `${stop.mobileX}%`,
    "--mobile-stop-y": `${stop.mobileY}%`,
  } as CSSProperties;
}

function StopGlyph({ stop, ordinal }: Readonly<{ stop: WorldStop; ordinal?: number }>) {
  if (stop.kind === "turbo") return <span aria-hidden="true">⚡</span>;
  if (stop.kind === "minigame") return <span aria-hidden="true">✦</span>;
  if (stop.kind === "culmination") return <span aria-hidden="true">★</span>;
  return <span aria-hidden="true">{ordinal ?? "•"}</span>;
}

function RequiredStopButton({
  stop,
  progress,
  qaUnlocked,
  onOpenStop,
  onInspectStop,
  busy,
  ordinal,
  current,
}: Readonly<{
  stop: MathStop;
  ordinal: number;
  current: boolean;
  busy: boolean;
  progress: WorldProgress;
  qaUnlocked: boolean;
  onOpenStop: (stopId: string) => void;
  onInspectStop: (stopId: string) => void;
}>) {
  const complete = progress.completedStopIds.includes(stop.id);
  const available = canOpenRequiredStop(progress, stop.id, qaUnlocked);
  const state = complete ? "complete" : current ? "current" : available ? "available" : "locked";
  const label = `${stop.label}. ${complete ? "Completed" : current ? "Next stop" : available ? "Available in test mode" : "Locked"}. ${stop.description}`;
  return (
    <li className={styles.mapStop} style={stopStyle(stop)} data-state={state} data-stop-id={stop.id}>
      <button
        type="button"
        className={styles.stopButton}
        disabled={!available || busy}
        aria-label={label}
        aria-current={current ? "step" : undefined}
        onClick={() => (complete && !qaUnlocked ? onInspectStop(stop.id) : onOpenStop(stop.id))}
      >
        <StopGlyph stop={stop} ordinal={ordinal} />
        <span className={styles.stopStateSymbol} aria-hidden="true">
          {complete ? "✓" : !available ? <svg viewBox="0 0 16 16" width="14" height="14"><path d="M5 7V5a3 3 0 0 1 6 0v2M4 7h8v7H4Z" fill="none" stroke="currentColor" strokeWidth="2" /></svg> : ""}
        </span>
      </button>
      <span className={styles.stopLabel}>{stop.shortLabel}</span>
    </li>
  );
}

function BreakStopLink({
  stop,
  progress,
  qaUnlocked,
  busy,
  onTravel,
}: Readonly<{
  busy: boolean;
  onTravel: (stop: BreakStop) => void;
  stop: BreakStop;
  progress: WorldProgress;
  qaUnlocked: boolean;
}>) {
  const available = qaUnlocked || progress.completedStopIds.includes(stop.afterStopId);
  const content = (
    <>
      <span className={styles.stopButton} aria-hidden="true">
        <StopGlyph stop={stop} />
      </span>
      <span className={styles.stopLabel}>{stop.shortLabel}</span>
    </>
  );
  return (
    <li
      className={`${styles.mapStop} ${styles.breakStop}`}
      style={stopStyle(stop)}
      data-state={available ? "bonus" : "locked"}
      data-stop-id={stop.id}
    >
      {available ? (
        <Link
          className={styles.breakLink}
          href={stop.href}
          aria-disabled={busy || undefined}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            if (!busy) onTravel(stop);
          }}
          aria-label={`${stop.label}. Optional break. ${stop.description}`}
        >
          {content}
        </Link>
      ) : (
        <span className={styles.breakLink} aria-label={`${stop.label}. Locked optional break.`}>
          {content}
        </span>
      )}
    </li>
  );
}

export function WorldMap({
  progress,
  qaUnlocked,
  onOpenStop,
  onInspectStop,
  onExportQa,
  avatarStopId,
  world,
  onChooseWorld,
}: MapProps) {
  const requiredStops = stopsForWorld(world.id);
  const breakStops = breaksForWorld(world.id);
  const questionCount = requiredStops.reduce((count, stop) => count + (QUESTIONS_BY_STOP.get(stop.id)?.length ?? 0), 0);
  const worldStops: readonly WorldStop[] = [...requiredStops, ...breakStops];
  const nextStopId = nextRequiredStopId(progress, world.id);
  const nextStop = requiredStops.find(({ id }) => id === nextStopId) ?? requiredStops.at(-1)!;
  const completedCount = requiredStops.filter(({ id }) => progress.completedStopIds.includes(id)).length;
  const complete = completedCount === requiredStops.length;
  const restoration = Math.round((completedCount / requiredStops.length) * 100);
  const completedStop = requiredStops.find(({ id }) => id === progress.checkpointStopId);
  const restingStopId = avatarStopId ?? progress.checkpointStopId;
  const restingStop = requiredStops.find(({ id }) => id === restingStopId)
    ?? [...requiredStops].reverse().find(({ id }) => progress.completedStopIds.includes(id))
    ?? requiredStops[0];
  const worldIndex = WORLD_DEFINITIONS.findIndex(({ id }) => id === world.id);
  const previousWorld = WORLD_DEFINITIONS[worldIndex - 1];
  const nextWorld = WORLD_DEFINITIONS[worldIndex + 1];
  const titleParts = world.title.split(" ");
  const lastTitlePart = titleParts.pop();
  let completedRoadSlot = -1;
  for (const stop of requiredStops) {
    if (!progress.completedStopIds.includes(stop.id)) break;
    completedRoadSlot = stop.mapSlot;
  }
  const { avatarRef, spriteRef, irisRef, mapRef, travel, travelTo } = useMapTravel(restingStop);
  const router = useRouter();
  const mapHeadingRef = useRef<HTMLHeadingElement>(null);
  const completedHeadingRef = useRef<HTMLHeadingElement>(null);
  const mountedRef = useRef(true);
  const preparingWorkbookRef = useRef(false);
  const [preparingWorkbook, setPreparingWorkbook] = useState(false);
  const [workbookError, setWorkbookError] = useState<string | null>(null);
  const busy = travel !== null;

  useEffect(() => {
    mountedRef.current = true;
    (completedHeadingRef.current ?? mapHeadingRef.current)?.focus({ preventScroll: true });
    return () => { mountedRef.current = false; };
  }, []);

  async function prepareWorkbook() {
    if (busy || preparingWorkbookRef.current) return;
    preparingWorkbookRef.current = true;
    setPreparingWorkbook(true);
    setWorkbookError(null);
    try {
      // Invoke within the click gesture so the helper can open its print window.
      await printWorldWorkbook(world);
    } catch (error) {
      if (mountedRef.current) {
        setWorkbookError(error instanceof Error && error.message
          ? error.message
          : "We couldn’t prepare the workbook. Please try again.");
      }
    } finally {
      preparingWorkbookRef.current = false;
      if (mountedRef.current) setPreparingWorkbook(false);
    }
  }

  function openWithTravel(stopId: string) {
    const stop = requiredStops.find(({ id }) => id === stopId);
    if (!stop || !canOpenRequiredStop(progress, stopId, qaUnlocked)) return;
    void travelTo(stop, () => onOpenStop(stopId));
  }

  return (
    <main className={styles.worldShell} data-world-id={world.id} data-launch-phase={travel?.phase ?? "idle"}>
      <nav className={styles.worldNavigation} aria-label="World navigation">
        <div className={styles.worldPicker}>
          <button type="button" className={styles.worldArrow} aria-label="Previous world"
            disabled={busy || !previousWorld || !canOpenWorld(progress, previousWorld.id, qaUnlocked)}
            onClick={() => previousWorld && onChooseWorld(previousWorld.id)}>←</button>
          <label className={styles.worldSelectLabel}>
            <span>Choose a world</span>
            <select aria-label="Choose a world" value={world.id} disabled={busy}
              onChange={(event) => onChooseWorld(event.target.value)}>
              {WORLD_DEFINITIONS.map((candidate) => {
                const finished = candidate.stopIds.every((id) => progress.completedStopIds.includes(id));
                const available = canOpenWorld(progress, candidate.id, qaUnlocked);
                return <option key={candidate.id} value={candidate.id} disabled={!available}>
                  {String(candidate.number).padStart(2, "0")} · {candidate.title} · {candidate.concept} {candidate.spiral}{finished ? " · ✓" : !available ? " · Locked" : ""}
                </option>;
              })}
            </select>
          </label>
          <button type="button" className={styles.worldArrow} aria-label="Next world"
            disabled={busy || !nextWorld || !canOpenWorld(progress, nextWorld.id, qaUnlocked)}
            onClick={() => nextWorld && onChooseWorld(nextWorld.id)}>→</button>
        </div>
        <span className={styles.worldSequence}>World {world.number} of {WORLD_DEFINITIONS.length}</span>
      </nav>
      <section className={styles.mapIntro} aria-labelledby="world-title">
        <div>
          <p className={styles.kicker}><span className={styles.worldNumber}>{String(world.number).padStart(2, "0")}</span> {world.concept} {world.spiral}</p>
          <h1 ref={mapHeadingRef} tabIndex={-1} id="world-title">{titleParts.join(" ")} <span>{lastTitlePart}</span></h1>
          <p>{world.description}</p>
          <div className={styles.worldTools}>
            <p className={styles.worldQuestionCount}>{requiredStops.length} stops · {questionCount} questions</p>
            <button
              type="button"
              className={styles.workbookButton}
              disabled={busy || preparingWorkbook}
              aria-busy={preparingWorkbook}
              aria-label={preparingWorkbook ? `Preparing workbook for ${world.title}` : `Print workbook for ${world.title}`}
              onClick={() => void prepareWorkbook()}
            >
              {preparingWorkbook ? <span className={styles.workbookSpinner} aria-hidden="true" /> : (
                <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
                  <path d="M5 7V2.5h10V7M5 14H2.5V7h15v7H15M5 11.5h10v6H5Z" />
                  <path d="M14.5 9h.5" strokeLinecap="round" />
                </svg>
              )}
              {preparingWorkbook ? "Preparing workbook…" : "Print workbook"}
            </button>
          </div>
          <p className={styles.srOnly} role="status">{preparingWorkbook ? `Preparing the workbook for ${world.title}…` : ""}</p>
          {workbookError && <p className={styles.workbookError} role="alert">{workbookError}</p>}
        </div>
        <div className={styles.mapProgress}>
          <div className={styles.progressCopy}>
            <span>Island explored</span>
            <strong>{completedCount}<span> / {requiredStops.length}</span></strong>
          </div>
          <div className={styles.progressTrack} role="progressbar"
            aria-label={`${world.title} completion`} aria-valuemin={0}
            aria-valuemax={requiredStops.length} aria-valuenow={completedCount}>
            <span style={{ width: `${restoration}%` }} />
          </div>
          <span>{complete ? "Every trail discovered. Beautiful work." : "Every solved trail opens a new path."}</span>
        </div>
      </section>

      {qaUnlocked && <div className={styles.testNotice} role="status"><strong>Test mode · all paths open</strong><span>Hop to any world or stop. Replay freely. Your adventure progress stays separate.</span></div>}

      {completedStop && <section className={styles.mapCompletion} aria-labelledby="completed-trail-title">
        <span className={styles.completionCheck} aria-hidden="true">✓</span>
        <div>
          <h2 ref={completedHeadingRef} tabIndex={-1} id="completed-trail-title">{completedStop.label} complete!</h2>
          <p>{QUESTIONS_BY_STOP.get(completedStop.id)?.length ?? 0} questions solved · {stopFirstTryAccuracy(progress.stopAttempts[completedStop.id], QUESTIONS_BY_STOP.get(completedStop.id) ?? [])}% first-try accuracy</p>
          <p>{complete ? "You explored every trail. Beautiful work!" : "Choose your next stop on the map."}</p>
        </div>
      </section>}

      <p className={styles.srOnly} role="status">{travel ? `Hopping to ${travel.stop.label}…` : ""}</p>
      <section className={styles.mapFrame} aria-label={`${world.title} world map`}>
        <div ref={mapRef} className={styles.mapCanvas} aria-busy={busy} data-restoration={Math.floor(restoration / 25)}>
          <CoastScene className={styles.mapArt} completedRoadSlot={completedRoadSlot} worldNumber={world.number} showDetours={breakStops.length > 0} />
          <CoastScene className={styles.mobileMapArt} mobile completedRoadSlot={completedRoadSlot} worldNumber={world.number} showDetours={breakStops.length > 0} />
          <div className={styles.mapCompass} aria-hidden="true"><span>✦</span> {world.title.toUpperCase()}</div>
          <div className={styles.mapLocation} aria-hidden="true">THE CURIOSITY ISLES</div>

          <ol className={styles.stopList} aria-label={`${world.title} stops`}>
            {worldStops.map((stop) =>
              "realmId" in stop ? (
                <RequiredStopButton
                  key={stop.id}
                  stop={stop}
                  ordinal={requiredStops.findIndex(({ id }) => id === stop.id) + 1}
                  current={nextStopId === stop.id}
                  progress={progress}
                  qaUnlocked={qaUnlocked}
                  busy={busy}
                  onOpenStop={openWithTravel}
                  onInspectStop={onInspectStop}
                />
              ) : (
                <BreakStopLink
                  key={stop.id}
                  stop={stop}
                  progress={progress}
                  qaUnlocked={qaUnlocked}
                  busy={busy}
                  onTravel={(destination) => void travelTo(destination, () => router.push(destination.href))}
                />
              ),
            )}
          </ol>

          <span ref={avatarRef} className={styles.mapAvatar} style={stopStyle(restingStop)} aria-hidden="true">
            <span ref={spriteRef} className={styles.avatarSprite}><Avatar avatar="hedgehog" size={62} state="idle" decorative eager /></span>
          </span>
        </div>
      </section>

      <section className={styles.mapActions} aria-label="World actions">
        <div className={styles.nextTrail}>
          <span className={styles.nextTrailIcon} aria-hidden="true">{complete ? "✓" : "⚑"}</span>
          <div><span>{complete ? "Island complete" : "Your next trail"}</span><strong>{nextStop.label}</strong></div>
          <small>{QUESTIONS_BY_STOP.get(nextStop.id)?.length ?? 0} questions · Untimed</small>
        </div>
        {complete && nextWorld ? (
          <button type="button" className={styles.primaryButton} disabled={busy || !canOpenWorld(progress, nextWorld.id, qaUnlocked)} onClick={() => onChooseWorld(nextWorld.id)}>
            Choose next world <span aria-hidden="true">→</span>
          </button>
        ) : (
          <button type="button" className={styles.primaryButton}
            onClick={() => nextStopId && openWithTravel(nextStopId)} disabled={!nextStopId || busy}>
            {complete ? "Adventure complete" : completedCount ? "Continue adventure" : "Let’s explore"}
            {!complete && <span aria-hidden="true">→</span>}
          </button>
        )}
      </section>

      <section className={styles.belowMap} aria-label="Explore the island">
        <details className={styles.trailDirectory}>
          <summary>All island trails <span>{requiredStops.length} trails{breakStops.length > 0 ? ` + ${breakStops.length} optional detours` : ""}</span></summary>
          <ol>
            {requiredStops.map((stop, index) => {
              const completed = progress.completedStopIds.includes(stop.id);
              const available = canOpenRequiredStop(progress, stop.id, qaUnlocked);
              return <li key={stop.id}><button type="button" disabled={!available || busy}
                aria-current={nextStopId === stop.id ? "step" : undefined}
                onClick={() => completed && !qaUnlocked ? onInspectStop(stop.id) : openWithTravel(stop.id)}>
                <span>{completed ? "✓" : String(index + 1).padStart(2, "0")}</span>
                <strong>{stop.label}</strong><small>{completed ? qaUnlocked ? "Replay" : "Completed" : available ? "Explore →" : "Locked"}</small>
              </button></li>;
            })}
          </ol>
        </details>
        <button type="button" disabled={busy} className={styles.notesLink} onClick={onExportQa}>↓ Export playtest notes</button>
      </section>
      <div ref={irisRef} className={styles.mapIris} aria-hidden="true" />
    </main>
  );
}
