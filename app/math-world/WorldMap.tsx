"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { Avatar } from "@/components/progression/avatar";
import {
  QUESTIONS_BY_STOP,
  REQUIRED_STOPS,
  WORLD_STOPS,
  type BreakStop,
  type MathStop,
  type WorldStop,
} from "./world-data.ts";
import {
  canOpenRequiredStop,
  nextRequiredStopId,
  type WorldProgress,
} from "./engine.ts";
import styles from "./math-world.module.css";
import CoastScene from "./CoastScene";

type MapProps = Readonly<{
  progress: WorldProgress;
  qaUnlocked: boolean;
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

function StopGlyph({ stop }: Readonly<{ stop: WorldStop }>) {
  if (stop.kind === "turbo") return <span aria-hidden="true">⚡</span>;
  if (stop.kind === "minigame") return <span aria-hidden="true">✦</span>;
  if (stop.kind === "culmination") return <span aria-hidden="true">★</span>;
  return <span aria-hidden="true">{REQUIRED_STOPS.findIndex(({ id }) => id === stop.id) + 1}</span>;
}

function RequiredStopButton({
  stop,
  progress,
  qaUnlocked,
  onOpenStop,
  onInspectStop,
}: Readonly<{
  stop: MathStop;
  progress: WorldProgress;
  qaUnlocked: boolean;
  onOpenStop: (stopId: string) => void;
  onInspectStop: (stopId: string) => void;
}>) {
  const complete = progress.completedStopIds.includes(stop.id);
  const current = nextRequiredStopId(progress) === stop.id;
  const available = canOpenRequiredStop(progress, stop.id, qaUnlocked);
  const state = complete ? "complete" : current ? "current" : available ? "available" : "locked";
  const label = `${stop.label}. ${complete ? "Completed" : current ? "Next stop" : available ? "Available in test mode" : "Locked"}. ${stop.description}`;
  return (
    <li className={styles.mapStop} style={stopStyle(stop)} data-state={state}>
      <button
        type="button"
        className={styles.stopButton}
        disabled={!available}
        aria-label={label}
        aria-current={current ? "step" : undefined}
        onClick={() => (complete && !qaUnlocked ? onInspectStop(stop.id) : onOpenStop(stop.id))}
      >
        <StopGlyph stop={stop} />
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
}: Readonly<{
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
    >
      {available ? (
        <Link
          className={styles.breakLink}
          href={stop.href}
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
}: MapProps) {
  const nextStopId = nextRequiredStopId(progress);
  const nextStop = REQUIRED_STOPS.find(({ id }) => id === nextStopId) ?? REQUIRED_STOPS.at(-1)!;
  const completedCount = progress.completedStopIds.length;
  const complete = completedCount === REQUIRED_STOPS.length;
  const restoration = Math.round((completedCount / REQUIRED_STOPS.length) * 100);

  return (
    <main className={styles.worldShell}>
      <section className={styles.mapIntro} aria-labelledby="world-title">
        <div>
          <p className={styles.kicker}><span className={styles.worldNumber}>01</span> Your island adventure</p>
          <h1 id="world-title">Counting <span>Coast</span></h1>
          <p>A little curiosity. A whole island to discover.</p>
        </div>
        <div className={styles.mapProgress}>
          <div className={styles.progressCopy}>
            <span>Island explored</span>
            <strong>{completedCount}<span> / {REQUIRED_STOPS.length}</span></strong>
          </div>
          <div className={styles.progressTrack} role="progressbar"
            aria-label="Counting Coast completion" aria-valuemin={0}
            aria-valuemax={REQUIRED_STOPS.length} aria-valuenow={completedCount}>
            <span style={{ width: `${restoration}%` }} />
          </div>
          <span>{complete ? "Every trail discovered. Beautiful work." : "Every solved trail opens a new path."}</span>
        </div>
      </section>

      {qaUnlocked && <div className={styles.testNotice} role="status"><strong>Test mode · all paths open</strong><span>Hop to any stop. Replay freely. Your adventure progress stays separate.</span></div>}

      <section className={styles.mapFrame} aria-label="Counting Coast world map">
        <div className={styles.mapCanvas} data-restoration={Math.floor(restoration / 25)}>
          <CoastScene className={styles.mapArt} completedCount={completedCount} />
          <CoastScene className={styles.mobileMapArt} mobile completedCount={completedCount} />
          <div className={styles.mapCompass} aria-hidden="true"><span>✦</span> COUNTING COAST</div>
          <div className={styles.mapLocation} aria-hidden="true">THE CURIOSITY ISLES</div>

          <ol className={styles.stopList} aria-label="Counting Coast stops">
            {WORLD_STOPS.map((stop) =>
              "realmId" in stop ? (
                <RequiredStopButton
                  key={stop.id}
                  stop={stop}
                  progress={progress}
                  qaUnlocked={qaUnlocked}
                  onOpenStop={onOpenStop}
                  onInspectStop={onInspectStop}
                />
              ) : (
                <BreakStopLink
                  key={stop.id}
                  stop={stop}
                  progress={progress}
                  qaUnlocked={qaUnlocked}
                />
              ),
            )}
          </ol>

          <span className={styles.mapAvatar} style={stopStyle(nextStop)} aria-hidden="true">
            <Avatar avatar="hedgehog" size={62} state={complete ? "celebrating" : "walking"} decorative eager />
          </span>
        </div>
      </section>

      <section className={styles.mapActions} aria-label="World actions">
        <div className={styles.nextTrail}>
          <span className={styles.nextTrailIcon} aria-hidden="true">{complete ? "✓" : "⚑"}</span>
          <div><span>{complete ? "Island complete" : "Your next trail"}</span><strong>{nextStop.label}</strong></div>
          <small>{QUESTIONS_BY_STOP.get(nextStop.id)?.length ?? 0} questions · Untimed</small>
        </div>
        <button type="button" className={styles.primaryButton}
          onClick={() => nextStopId && onOpenStop(nextStopId)} disabled={!nextStopId}>
          {complete ? "Coast complete" : completedCount ? "Continue adventure" : "Let’s explore"}
          {!complete && <span aria-hidden="true">→</span>}
        </button>
      </section>

      <section className={styles.belowMap} aria-label="Explore the island">
        <details className={styles.trailDirectory}>
          <summary>All island trails <span>9 trails + 2 optional detours</span></summary>
          <ol>
            {REQUIRED_STOPS.map((stop, index) => {
              const completed = progress.completedStopIds.includes(stop.id);
              const available = canOpenRequiredStop(progress, stop.id, qaUnlocked);
              return <li key={stop.id}><button type="button" disabled={!available}
                aria-current={nextStopId === stop.id ? "step" : undefined}
                onClick={() => completed && !qaUnlocked ? onInspectStop(stop.id) : onOpenStop(stop.id)}>
                <span>{completed ? "✓" : String(index + 1).padStart(2, "0")}</span>
                <strong>{stop.label}</strong><small>{completed ? qaUnlocked ? "Replay" : "Completed" : available ? "Explore →" : "Locked"}</small>
              </button></li>;
            })}
          </ol>
        </details>
        <button type="button" className={styles.notesLink} onClick={onExportQa}>↓ Export playtest notes</button>
      </section>
    </main>
  );
}
