"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GlobeBoard, type GlobeBoardHandle } from "./GlobeBoard";
import { WorldNavigation } from "./WorldNavigation";
import { BOSS_CHALLENGES, bossAfterWorld, canOpenBoss, type BossChallenge } from "./boss-challenges.ts";
import { canOpenRequiredStop, canOpenWorld, nextRequiredStopId, stopFirstTryAccuracy, type WorldProgress } from "./engine.ts";
import { QUESTIONS_BY_STOP, WORLD_DEFINITIONS, stopsForWorld, type WorldDefinition } from "./world-data.ts";
import { printWorldWorkbook } from "./workbook.ts";
import { printBossWorkbook } from "./boss-workbook.ts";
import shell from "./math-world.module.css";
import styles from "./globe.module.css";

type Props = {
  world: WorldDefinition; boss: BossChallenge | null; progress: WorldProgress; qaUnlocked: boolean;
  avatarStopId: string | null; onChooseWorld: (id: string) => void; onChooseBoss: (boss: BossChallenge) => void;
  onOpenStop: (id: string) => void; onInspectStop: (id: string) => void; onExportQa: () => void;
};

export function GlobeAdventure(props: Props) {
  const { world, boss, progress, qaUnlocked } = props;
  const boardRef = useRef<GlobeBoardHandle>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const storyRef = useRef<HTMLDialogElement>(null);
  const storyOpener = useRef<HTMLButtonElement | null>(null);
  const [story, setStory] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const mounted = useRef(true), printingRef = useRef(false);
  const [initialOverview] = useState(() => !props.avatarStopId && !progress.checkpointStopId && Object.keys(progress.stopAttempts).length === 0);
  const destinationId = boss?.id ?? world.id;
  const stops = stopsForWorld(world.id);
  const completedCount = stops.filter(stop => progress.completedStopIds.includes(stop.id)).length;
  const complete = completedCount === stops.length;
  const questions = stops.reduce((sum, stop) => sum + (QUESTIONS_BY_STOP.get(stop.id)?.length ?? 0), 0);
  const checkpoint = stops.find(stop => stop.id === progress.checkpointStopId);
  const nextStopId = nextRequiredStopId(progress, world.id);
  const nextBoss = bossAfterWorld(world.number);
  const nextWorld = WORLD_DEFINITIONS.find(candidate => candidate.number === (boss ? Math.min(boss.afterWorld + 1, WORLD_DEFINITIONS.length) : world.number + 1));
  const onBusyChange = useCallback((value: boolean) => setBusy(value), []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, [destinationId]);
  useEffect(() => { if (story !== null && !storyRef.current?.open) storyRef.current?.showModal(); }, [story]);
  function navigate(id: string) {
    setPrintError(null);
    const targetBoss = BOSS_CHALLENGES.find(candidate => candidate.id === id);
    if (targetBoss) props.onChooseBoss(targetBoss); else props.onChooseWorld(id);
  }
  async function print() {
    if (printingRef.current || busy) return;
    printingRef.current = true; setPrinting(true); setPrintError(null);
    try { if (boss) await printBossWorkbook(boss); else await printWorldWorkbook(world); }
    catch (error) { if (mounted.current) setPrintError(error instanceof Error ? error.message : "The workbook could not be prepared. Please try again."); }
    finally { printingRef.current = false; if (mounted.current) setPrinting(false); }
  }
  return <main className={styles.adventure} data-world-id={boss ? undefined : world.id} data-boss-id={boss?.id}>
    <WorldNavigation selectedId={destinationId} progress={progress} qaUnlocked={qaUnlocked} busy={busy || printing}
      onChooseWorld={id => boardRef.current?.sailTo(id)} onChooseBoss={boss => boardRef.current?.sailTo(boss.id)} />
    <header className={styles.destinationHeader}>
      <div><p className={styles.kicker}>{boss ? `After World ${boss.afterWorld} · Challenge placeholder` : `World ${world.number} · ${world.concept} ${world.spiral}`}</p>
        <h1 ref={headingRef} tabIndex={-1}>{boss?.title ?? world.title}</h1>
        <p className={styles.description}>{boss ? `Math Kangaroo ${boss.year} · Grades 1–2 · 24 questions` : world.description}</p>
      </div>
      <button type="button" className={styles.printButton} disabled={busy || printing} aria-busy={printing}
        aria-label={printing ? "Preparing workbook" : boss ? `Print whole ${boss.year} test workbook` : `Print workbook for ${world.title}`}
        onClick={() => void print()}><span aria-hidden="true">▤</span>{printing ? "Preparing workbook…" : boss ? "Print whole test workbook" : "Print workbook"}</button>
    </header>
    {printError && <p role="alert" className={styles.error}>{printError}</p>}
    {qaUnlocked && <p className={styles.testNotice}><strong>Test mode</strong><span>Every archipelago is open. Your adventure progress stays separate.</span></p>}
    {!boss && <div className={styles.progressRow}><span>{completedCount} / {stops.length} stops explored</span><progress aria-label={`${world.title} completion`} max={stops.length} value={completedCount} /><span>{questions} questions · Untimed</span></div>}
    {checkpoint && !boss && <div className={styles.completion} role="status"><span aria-hidden="true">✓</span><div><strong>{complete ? "Archipelago complete!" : `${checkpoint.shortLabel} complete!`}</strong><p>{QUESTIONS_BY_STOP.get(checkpoint.id)?.length} questions solved · {stopFirstTryAccuracy(progress.stopAttempts[checkpoint.id], QUESTIONS_BY_STOP.get(checkpoint.id) ?? [])}% first-try accuracy</p></div></div>}
    <GlobeBoard ref={boardRef} world={world} boss={boss} progress={progress} qaUnlocked={qaUnlocked}
      initialOverview={initialOverview} restingStopId={props.avatarStopId ?? progress.checkpointStopId}
      onNavigate={navigate} onOpenStop={props.onOpenStop} onInspectStop={props.onInspectStop} onBusyChange={onBusyChange}
      onStory={(index, opener) => { storyOpener.current = opener; setStory(index); }} />
    <section className={styles.actions} aria-label="World actions">
      <div><strong>{boss ? "A full test awaits" : complete ? "Every trail explored" : "Your next discovery"}</strong><p>{boss ? "Print the test and work through it with pencil and paper." : complete ? "Your boat is ready for the next adventure." : "Choose a stop on the globe, or explore the list below."}</p></div>
      {boss ? nextWorld && <button className={styles.primary} disabled={busy || printing || !canOpenWorld(progress, nextWorld.id, qaUnlocked)} onClick={() => boardRef.current?.sailTo(nextWorld.id)}>{boss.afterWorld === WORLD_DEFINITIONS.length ? `Back to World ${nextWorld.number}` : `Continue to World ${nextWorld.number}`} →</button>
        : complete && nextBoss ? <button className={styles.primary} disabled={busy || printing || !canOpenBoss(progress, nextBoss, qaUnlocked)} onClick={() => boardRef.current?.sailTo(nextBoss.id)}>Open {nextBoss.year} Boss Challenge →</button>
          : complete && nextWorld ? <button className={styles.primary} disabled={busy || printing || !canOpenWorld(progress, nextWorld.id, qaUnlocked)} onClick={() => boardRef.current?.sailTo(nextWorld.id)}>Sail to {nextWorld.title} →</button>
            : <button className={styles.primary} disabled={busy || printing || !nextStopId} onClick={() => nextStopId && boardRef.current?.openStop(nextStopId)}>{completedCount ? "Continue adventure" : "Let’s explore"} →</button>}
    </section>
    {boss ? <section className={styles.bossNote}><strong>Boss world coming soon</strong><p>The boss design and answer-entry adventure are still to come. For now, you can print the test and continue exploring.</p></section>
      : <details className={styles.directory}><summary>Explore the island stops</summary><ol>{stops.map((stop, index) => {
        const done = progress.completedStopIds.includes(stop.id); const available = canOpenRequiredStop(progress, stop.id, qaUnlocked);
        return <li key={stop.id}><button type="button" disabled={!available || busy} aria-current={nextStopId === stop.id ? "step" : undefined} onClick={() => done && !qaUnlocked ? props.onInspectStop(stop.id) : boardRef.current?.openStop(stop.id)}><span>{done ? "✓" : index + 1}</span><strong>{stop.shortLabel}</strong><small>{QUESTIONS_BY_STOP.get(stop.id)?.length} questions · {done ? qaUnlocked ? "Replay" : "Completed" : available ? "Explore" : "Locked"}</small></button></li>;
      })}</ol></details>}
    {qaUnlocked && <button type="button" className={styles.exportButton} onClick={props.onExportQa}>Export playtest notes</button>}
    <dialog ref={storyRef} className={shell.storyDialog} aria-labelledby="globe-story-title" onClose={() => { setStory(null); storyOpener.current?.focus({ preventScroll: true }); }}>
      <div className={styles.storyIcon} aria-hidden="true">▤</div><p className={styles.kicker}>{world.title} · Island {(story ?? 0) + 1}</p>
      <h2 id="globe-story-title">Story coming soon</h2><p>A little story will connect this island to the rest of the adventure.</p>
      <button type="button" className={styles.primary} onClick={() => storyRef.current?.close()}>Back to the map</button>
    </dialog>
  </main>;
}
