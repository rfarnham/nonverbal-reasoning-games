"use client";

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import {
  Avatar, AVATAR_OPTIONS, DEFAULT_AVATAR_ID, getAvatarOption, isAvatarId, type AvatarId,
} from "@/components/progression/avatar";
import type { Saved } from "./progress";
import {
  getMemoryRewards, getSessionRewards, MEMORY_HABITATS, MEMORY_STOPS_PER_HABITAT,
  MEMORY_XP_PER_ATTEMPT, MEMORY_XP_PER_STOP, type MemoryTrophy,
} from "./rewards";
import styles from "./adventure.module.css";

const STOP_POSITIONS = [
  [13, 68], [30, 32], [50, 58], [70, 26], [87, 60],
] as const;

function Arrow({ back = false }: { back?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={back ? "M19 12H5m6-6-6 6 6 6" : "M5 12h14m-6-6 6 6-6 6"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Star({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2l-5-4.9 6.9-1z" fill="currentColor" /></svg>;
}

function Scenery({ habitat }: { habitat: number }) {
  const night = habitat >= 3;
  return (
    <svg className={styles.scenery} viewBox="0 0 800 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {night ? <>
        <path d="M656 40a28 28 0 1 1-30 39 30 30 0 0 0 30-39Z" className={styles.moon} />
        <g className={styles.skyStars}><path d="M182 35v12m-6-6h12M376 52v10m-5-5h10M580 22v10m-5-5h10M724 92v10m-5-5h10" /></g>
      </> : <>
        <circle cx="653" cy="55" r="25" className={styles.sun} />
        <path d="M147 53h57a13 13 0 0 0-12-18 20 20 0 0 0-38 2 9 9 0 0 0-7 16Zm321 26h46a11 11 0 0 0-10-15 17 17 0 0 0-32 2 7 7 0 0 0-4 13Z" className={styles.cloud} />
      </>}
      {habitat === 4 && <path d="m170 205 164-142 124 142 109-104 171 176H82Z" className={styles.mountains} />}
      <path d="M-50 212Q96 136 240 193T540 174T850 209V390H-50Z" className={styles.farHill} />
      <path d="M-50 268Q124 194 315 256T630 225T850 258V390H-50Z" className={styles.nearHill} />
      {habitat === 1 && <path d="M-40 285Q155 225 287 286T529 285T848 311" className={styles.brook} />}
      <g className={styles.trees}>
        <path d="M30 243v-59m-24 34 24-38 24 38ZM774 263v-64m-26 36 26-42 26 42Z" />
        <path d="M66 326v-39m-16 22 16-28 16 28Z" />
      </g>
      <g className={styles.grass}>
        <path d="m195 325 4-12 5 12 5-8m350 17 4-14 6 14 6-9m-378-107 4-11 5 11m356-55 4-10 5 10" />
      </g>
      <g className={styles.pebbles}><ellipse cx="244" cy="341" rx="9" ry="4" /><ellipse cx="259" cy="337" rx="5" ry="3" /><ellipse cx="640" cy="326" rx="8" ry="4" /></g>
    </svg>
  );
}

function TrophyArtwork({ trophy }: { trophy: MemoryTrophy }) {
  return (
    <svg className={styles.trophyArtwork} data-earned={trophy.earned} viewBox="0 0 80 88" aria-hidden="true">
      <path d="m26 53-5 29 19-9 19 9-5-29" className={styles.ribbon} />
      <circle cx="40" cy="36" r="31" className={styles.medal} />
      <circle cx="40" cy="36" r="24" className={styles.medalInset} />
      <g className={styles.medalMark}>
        {trophy.id === "first-footsteps" ? <>
          <ellipse cx="33" cy="41" rx="4" ry="8" transform="rotate(-22 33 41)" /><ellipse cx="47" cy="31" rx="4" ry="8" transform="rotate(22 47 31)" />
        </> : trophy.id === "trail-explorer" ? <>
          <path d="m40 20 5 11 11 5-11 5-5 11-5-11-11-5 11-5Z" /><path d="m40 29 7 7-7 7-7-7Z" />
        </> : trophy.id === "expedition-explorer" ? <>
          <path d="m22 49 15-27 11 18 5-9 10 18ZM31 32l6 4 5-4" />
        </> : trophy.id === "bright-eyes" ? <>
          <path d="M21 36s7-12 19-12 19 12 19 12-7 12-19 12-19-12-19-12Z" /><circle cx="40" cy="36" r="6" />
        </> : trophy.id === "listening-ears" ? <>
          <path d="M30 30a11 11 0 0 1 22 0c0 10-10 10-10 17a6 6 0 0 1-12 0m6-16a5 5 0 0 1 10 0c0 5-7 6-7 11" />
        </> : <>
          <path d="M31 43c0-5-5-7-5-14a14 14 0 0 1 28 0c0 7-5 9-5 14ZM33 49h14m-11 6h8m-4-13V30m-5 0 5 5 5-5" />
        </>}
      </g>
    </svg>
  );
}

function Trophy({ trophy }: { trophy: MemoryTrophy }) {
  return (
    <li className={styles.trophy} data-earned={trophy.earned} aria-label={`${trophy.title}, ${trophy.earned ? "earned" : `${trophy.progress} of ${trophy.goal}`}`}>
      <TrophyArtwork trophy={trophy} />
      <div><h3>{trophy.title}</h3><p>{trophy.description}</p>
        <span className={styles.trophyProgress}>{trophy.earned ? "Earned ✓" : `${trophy.progress} / ${trophy.goal}`}</span>
      </div>
    </li>
  );
}

export interface MemoryTrailProps {
  saved: Saved;
  onStart: () => void;
  onBuddyChange: (id: AvatarId) => void;
  hasActiveSession: boolean;
  startDisabled?: boolean;
  nextGameTitle?: string;
}

export function MemoryTrail({ saved, onStart, onBuddyChange, hasActiveSession, startDisabled = false, nextGameTitle }: MemoryTrailProps) {
  const rewards = getMemoryRewards(saved);
  const [viewedHabitat, setViewedHabitat] = useState(rewards.habitatIndex);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const trailRef = useRef<HTMLElement>(null);
  const habitat = MEMORY_HABITATS[viewedHabitat];
  const currentHabitat = MEMORY_HABITATS[rewards.habitatIndex];
  const buddy = isAvatarId(saved.buddy) ? saved.buddy : DEFAULT_AVATAR_ID;
  const buddyName = getAvatarOption(buddy).name;
  const stopAttempts = rewards.stopXp / MEMORY_XP_PER_ATTEMPT;
  const challengesPerStop = MEMORY_XP_PER_STOP / MEMORY_XP_PER_ATTEMPT;
  const expeditionOffset = (rewards.expedition - 1) * MEMORY_STOPS_PER_HABITAT * MEMORY_HABITATS.length;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const button = primaryRef.current;
      button?.focus({ preventScroll: true });
      const bounds = button?.getBoundingClientRect();
      if (bounds && (bounds.top < 0 || bounds.bottom > window.innerHeight)) {
        trailRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <section className={styles.adventure} aria-label="Memory Trail" ref={trailRef}>
      <div className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Your Memory Trail</p>
          <h1>Memory Lab</h1>
          <p className={styles.welcome}>Take your trail buddy exploring.</p>
          <button className={styles.primary} onClick={onStart} disabled={startDisabled} ref={primaryRef}>
            {hasActiveSession ? "Continue adventure" : "Start adventure"}<Arrow />
          </button>
          <p className={styles.startDetail}>{hasActiveSession ? "Your place is saved." : `8 challenges${nextGameTitle ? ` · ${nextGameTitle}` : ""}`}</p>
        </div>
        <div className={styles.buddyCard}>
          <Avatar avatar={buddy} size={112} label={`${buddyName}, your trail buddy`} eager />
          <p className={styles.xpTotal} aria-label={`${rewards.xp} memory XP`}><Star /><strong>{rewards.xp.toLocaleString()}</strong><span>XP</span></p>
          <details className={styles.buddyPicker}>
            <summary>Choose your buddy</summary>
            <div className={styles.buddyOptions} role="group" aria-label="Trail buddies">
              {AVATAR_OPTIONS.map((option) => <button key={option.id} onClick={() => onBuddyChange(option.id)} aria-pressed={buddy === option.id} aria-label={option.name}>
                <Avatar avatar={option.id} size={48} decorative /><span>{option.name}</span>
              </button>)}
            </div>
          </details>
        </div>
      </div>

      <div className={styles.trailHeader}>
        <div><p className={styles.eyebrow}>Memory Trail · Expedition {rewards.expedition}</p><h2>{habitat.title}</h2><p>{habitat.description}</p></div>
        <nav className={styles.habitatNav} aria-label="Memory trail habitats">
          <button onClick={() => setViewedHabitat((value) => Math.max(0, value - 1))} disabled={viewedHabitat === 0} aria-label="Preview previous habitat"><Arrow back /></button>
          <label className={styles.habitatSelect}><span>Habitat</span><select aria-label="Trail habitat" value={viewedHabitat} onChange={(event) => setViewedHabitat(Number(event.target.value))}>
            {MEMORY_HABITATS.map((option, index) => <option value={index} key={option.id}>{option.title}</option>)}
          </select></label>
          <button onClick={() => setViewedHabitat((value) => Math.min(MEMORY_HABITATS.length - 1, value + 1))} disabled={viewedHabitat === MEMORY_HABITATS.length - 1} aria-label="Preview next habitat"><Arrow /></button>
        </nav>
      </div>

      <section className={styles.landscape} data-habitat={habitat.id} aria-label={`${habitat.title} trail`}>
        <Scenery habitat={viewedHabitat} />
        <svg className={styles.path} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M13 68C14 48 20 24 30 32S39 70 50 58 58 17 70 26 83 37 87 60" /></svg>
        <ol className={styles.stops}>
          {STOP_POSITIONS.map(([x, y], index) => {
            const stop = viewedHabitat * MEMORY_STOPS_PER_HABITAT + index + 1;
            const absoluteStop = expeditionOffset + stop;
            const complete = rewards.completedStops >= absoluteStop;
            const current = rewards.completedStops + 1 === absoluteStop;
            const position = { "--stop-x": `${x}%`, "--stop-y": `${y}%` } as CSSProperties;
            return <li key={stop} className={styles.stop} style={position} data-state={current ? "current" : complete ? "complete" : "ahead"} aria-current={current ? "step" : undefined}>
              {current && <Avatar className={styles.walker} avatar={buddy} size={54} decorative />}
              {current ? <button className={styles.stopCircle} onClick={onStart} disabled={startDisabled} aria-label={`${hasActiveSession ? "Continue" : "Start"} adventure at stop ${stop}`}><span>{stop}</span></button>
                : <span className={styles.stopCircle} aria-hidden="true">{complete ? <svg viewBox="0 0 24 24" fill="none"><path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg> : stop}</span>}
              <span className={styles.stopLabel}>Stop {stop}<small>{current ? "You are here" : complete ? "Explored" : "Up ahead"}</small></span>
            </li>;
          })}
        </ol>
        {viewedHabitat !== rewards.habitatIndex && <button className={styles.returnToCurrent} onClick={() => setViewedHabitat(rewards.habitatIndex)}>Back to {currentHabitat.title}<Arrow back /></button>}
      </section>

      <div className={styles.trailProgress}>
        <div><strong>{stopAttempts} / {challengesPerStop} challenges</strong><span>to your next trail stop</span></div>
        <div className={styles.progressTrack} role="progressbar" aria-label="Current trail stop" aria-valuemin={0} aria-valuemax={challengesPerStop} aria-valuenow={stopAttempts} aria-valuetext={`${stopAttempts} of ${challengesPerStop} challenges toward your next trail stop`}><span style={{ width: `${rewards.stopXp / MEMORY_XP_PER_STOP * 100}%` }} /></div>
        <p>Every first try earns {MEMORY_XP_PER_ATTEMPT} XP. Keep exploring at your own pace.</p>
      </div>

      <section className={styles.trophyShelf} aria-label="Memory trophies">
        <div className={styles.shelfHeading}><h2>Trophy shelf</h2><span>{rewards.trophies.filter((trophy) => trophy.earned).length} / {rewards.trophies.length} earned</span></div>
        <ul className={styles.trophies}>{rewards.trophies.map((trophy) => <Trophy key={trophy.id} trophy={trophy} />)}</ul>
      </section>
    </section>
  );
}

export function MemoryCelebration({ saved, onHome, headingRef }: { saved: Saved; onHome: () => void; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const session = getSessionRewards(saved);
  const rewards = session.after;
  const buddy = isAvatarId(saved.buddy) ? saved.buddy : DEFAULT_AVATAR_ID;
  const reachedHabitat = rewards.habitatIndex !== session.before.habitatIndex || rewards.expedition !== session.before.expedition;
  const reachedStop = rewards.completedStops > session.before.completedStops;
  const habitat = MEMORY_HABITATS[rewards.habitatIndex];
  const stopsEarned = rewards.completedStops - session.before.completedStops;
  const message = reachedHabitat ? `${habitat.title} is ready to explore.` : reachedStop ? `${stopsEarned === 1 ? "One more trail stop" : `${stopsEarned} trail stops`} explored!` : "Your practice is saved.";
  return (
    <section className={styles.celebration} aria-label="Adventure celebration">
      <div className={styles.celebrationPortrait}><Avatar avatar={buddy} size="hero" state={reachedHabitat ? "level-up" : "celebrating"} label="Your trail buddy celebrating" eager /><span className={styles.celebrationStar}><Star /></span></div>
      <p className={styles.eyebrow}>Memory Trail · Expedition {rewards.expedition}</p>
      <h1 ref={headingRef} tabIndex={-1}>Session complete</h1>
      <p className={styles.celebrationMessage}>{message}</p>
      <div className={styles.sessionXp} aria-label={`${session.xp} XP earned this session`}><Star /><strong>+{session.xp}</strong><span>XP</span></div>
      <div className={styles.sessionFacts}><span><strong>{session.attempts}</strong> challenges practised</span><span><strong>{session.correct} / {session.attempts}</strong> correct on the first try</span></div>
      {session.earnedTrophies.length > 0 && <div className={styles.newTrophies} role="group" aria-label="New trophies"><h2>{session.earnedTrophies.length === 1 ? "A new trophy!" : "New trophies!"}</h2><ul className={styles.trophies}>{session.earnedTrophies.map((trophy) => <Trophy key={trophy.id} trophy={trophy} />)}</ul></div>}
      <button className={styles.primary} onClick={onHome}>Back to trail<Arrow /></button>
      <p className={styles.savedNote}>{rewards.xp.toLocaleString()} total XP · Your trail is saved on this device.</p>
    </section>
  );
}
