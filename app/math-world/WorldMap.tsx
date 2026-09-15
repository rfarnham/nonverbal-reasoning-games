"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { Avatar } from "@/components/progression/avatar";
import {
  REALMS,
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
  if (!("realmId" in stop) || stop.realmId === "mixed") {
    return <span aria-hidden="true">★</span>;
  }
  const realm = REALMS[stop.realmId];
  return <span aria-hidden="true">{realm.icon}</span>;
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
  const label = `${stop.label}. ${complete ? "Completed" : current ? "Next stop" : available ? "Available in QA mode" : "Locked"}. ${stop.description}`;
  return (
    <li className={styles.mapStop} style={stopStyle(stop)} data-state={state}>
      <button
        type="button"
        className={styles.stopButton}
        disabled={!available}
        aria-label={label}
        aria-current={current ? "step" : undefined}
        onClick={() => (complete ? onInspectStop(stop.id) : onOpenStop(stop.id))}
      >
        <StopGlyph stop={stop} />
        <span className={styles.stopStateSymbol} aria-hidden="true">
          {complete ? "✓" : !available ? "⌁" : ""}
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
          <p className={styles.kicker}>Math Kangaroo Worlds · World 1</p>
          <h1 id="world-title">Counting Coast</h1>
          <p>
            Follow the island road through original Math Kangaroo questions.
            Turbo and minigame stops are optional scenic breaks.
          </p>
        </div>
        <div className={styles.mapProgress}>
          <div className={styles.progressCopy}>
            <span>Coast restored</span>
            <strong>{restoration}%</strong>
          </div>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-label="Counting Coast completion"
            aria-valuemin={0}
            aria-valuemax={REQUIRED_STOPS.length}
            aria-valuenow={completedCount}
          >
            <span style={{ width: `${restoration}%` }} />
          </div>
          <span>{completedCount} of {REQUIRED_STOPS.length} Math Kangaroo stops</span>
        </div>
      </section>

      <section className={styles.mapFrame} aria-label="Counting Coast world map">
        <div className={styles.mapCanvas} data-restoration={Math.floor(restoration / 25)}>
          <svg
            className={styles.mapArt}
            viewBox="0 0 1000 760"
            role="img"
            aria-label="A sunny island coast with number terraces, violet shape cliffs, and a teal clockwork harbor."
          >
            <defs>
              <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#55c6d1" />
                <stop offset="1" stopColor="#2c9bb3" />
              </linearGradient>
              <filter id="softShadow" x="-20%" y="-20%" width="140%" height="160%">
                <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#185f74" floodOpacity=".25" />
              </filter>
              <pattern id="waves" width="42" height="28" patternUnits="userSpaceOnUse">
                <path d="M0 14 Q10 5 21 14 T42 14" fill="none" stroke="#fff" strokeOpacity=".22" strokeWidth="3" />
              </pattern>
            </defs>
            <rect width="1000" height="760" rx="44" fill="url(#sea)" />
            <rect width="1000" height="760" rx="44" fill="url(#waves)" />
            <g className={styles.clouds} fill="#fff" opacity=".8">
              <path d="M90 90c12-25 49-22 57 4 23-16 53 0 52 28H60c-2-19 12-34 30-32Z" />
              <path d="M742 92c10-21 42-20 50 3 21-14 46 0 46 25H715c0-17 12-30 27-28Z" />
            </g>
            <g filter="url(#softShadow)">
              <path d="M57 564C79 455 193 386 318 411c83 17 127 88 217 84 90-5 127-88 219-108 84-18 176 13 196 103 21 95-76 155-165 153-110-3-168 60-279 55-93-4-124-69-214-53-119 21-261 16-235-81Z" fill="#f8d572" />
              <path d="M77 550c37-90 131-133 228-113 75 16 132 83 219 73 88-10 128-91 220-105 71-11 148 17 175 77-64-13-114 6-151 49-49 56-109 78-181 62-76-17-122 26-190 31-77 6-124-44-198-25-51 13-91-2-122-49Z" fill="#87ca6b" />
              <path d="M514 492c78-7 122-86 211-91 64-4 133 30 169 81-64-11-112 9-148 51-47 53-107 75-177 55-46-13-81 3-121 19 20-60 15-109 66-115Z" fill="#8b79d6" />
              <path d="M612 433c36-72 116-129 206-111 60 12 103 58 113 117-31-26-73-39-119-34-82 8-122 73-200 85-23 4-45 2-64-5 25-14 47-31 64-52Z" fill="#58bea3" />
            </g>
            <g className={styles.mapDetails} strokeLinecap="round" strokeLinejoin="round">
              <path d="M124 528c42-54 87-59 143-55M144 558c50-46 103-51 158-28M296 592c48-52 100-63 157-33" fill="none" stroke="#e0a741" strokeWidth="15" opacity=".85" />
              <path d="M559 528l48-69 48 58 48-84 57 70" fill="none" stroke="#6858b6" strokeWidth="22" opacity=".72" />
              <path d="M703 399c41-43 92-54 151-32" fill="none" stroke="#298b7a" strokeWidth="18" opacity=".68" />
              <g fill="#fff4ca" stroke="#b9753e" strokeWidth="5">
                <path d="M422 482v-70l49-33 49 33v70Z" />
                <path d="M742 371v-92h52v92Z" />
                <circle cx="768" cy="306" r="17" />
              </g>
              <g className={styles.restorationDetails}>
                <path d="M838 447v-104l32-42 32 42v104Z" fill="#fff8de" stroke="#1f5b72" strokeWidth="7" />
                <path d="M858 301v-52" stroke="#1f5b72" strokeWidth="7" />
                <path d="M862 250l58 18-58 18Z" fill="#f06f5f" stroke="#1f5b72" strokeWidth="5" />
                <path d="M826 446h88" stroke="#1f5b72" strokeWidth="8" />
                <path d="M854 337h32v42h-32Z" fill="#ffe976" stroke="#1f5b72" strokeWidth="5" />
              </g>
              <g fill="#27836f">
                <circle cx="177" cy="454" r="18" /><circle cx="206" cy="445" r="22" />
                <circle cx="345" cy="428" r="19" /><circle cx="369" cy="421" r="15" />
                <circle cx="686" cy="421" r="17" /><circle cx="711" cy="411" r="21" />
              </g>
              <g fill="#fef6d2" stroke="#725134" strokeWidth="4">
                <path d="M195 470v42M176 490h39" /><path d="M346 441v44M329 458h37" />
              </g>
            </g>
            <path
              className={styles.routeLine}
              d="M120 578C181 563 217 513 275 496S355 574 412 579s69-97 118-111 82 74 139 52 41-117 98-146 65 7 90 2"
              fill="none"
              stroke="#fff7dc"
              strokeWidth="13"
              strokeDasharray="5 20"
              strokeLinecap="round"
            />
          </svg>

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
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => nextStopId && onOpenStop(nextStopId)}
          disabled={!nextStopId}
        >
          {complete ? "Counting Coast complete" : `Continue to ${nextStop.label}`}
          {!complete && <span aria-hidden="true">→</span>}
        </button>
        <button type="button" className={styles.secondaryButton} onClick={onExportQa}>
          Export playtest notes
        </button>
        {qaUnlocked && <span className={styles.qaBadge}>QA mode · all stops open</span>}
      </section>

      <section className={styles.realmLegend} aria-labelledby="realm-legend-title">
        <div>
          <p className={styles.kicker}>Curriculum geography</p>
          <h2 id="realm-legend-title">Three realms meet on this coast.</h2>
          <p>Future worlds revisit these realm icons in new terrain and add Logic, Patterns, and Possibilities.</p>
        </div>
        <ul>
          {Object.entries(REALMS).map(([id, realm]) => (
            <li key={id} style={{ "--realm-color": realm.color } as CSSProperties}>
              <span aria-hidden="true">{realm.icon}</span>
              <div><strong>{realm.label}</strong><small>{realm.shortLabel}</small></div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
