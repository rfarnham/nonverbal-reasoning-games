"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import {
  createGameAudioContext,
  playFeedbackEarcon,
  readSoundPreference,
  writeSoundPreference,
} from "@/lib/game-audio";
import {
  advanceQuestion,
  allowRetry,
  answerQuestion,
  createInitialProgress,
  canOpenWorld,
  selectWorld,
  leaveCheckpoint,
  startStop,
  stopFirstTryAccuracy,
  type WorldProgress,
} from "./engine.ts";
import {
  downloadQaArchive,
  readQaArchive,
  readWorldProgress,
  readWorldPlaytestMode,
  rememberFirstQaSelection,
  writeQaRecord,
  writeWorldProgress,
  type QaCategory,
} from "./storage.ts";
import {
  QUESTIONS_BY_STOP,
  REQUIRED_STOPS,
  WORLD_DEFINITIONS,
  WORLD_MODE,
  worldForStop,
  type MathStop,
  type WorldQuestion,
} from "./world-data.ts";
import { WorldMap } from "./WorldMap";
import { BossWorld } from "./BossWorld";
import { GlobeAdventure } from "./GlobeAdventure";
import { bossById, canOpenBoss, type BossChallenge } from "./boss-challenges.ts";
import styles from "./math-world.module.css";

const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
const LETTERS = ["A", "B", "C", "D", "E"] as const;
const QA_CATEGORIES: readonly Readonly<{ id: QaCategory; label: string }>[] = [
  { id: "answer-key", label: "Answer key" },
  { id: "prompt-wording", label: "Prompt wording" },
  { id: "image-crop", label: "Image or crop" },
  { id: "curriculum-placement", label: "Curriculum placement" },
  { id: "difficulty-order", label: "Difficulty or order" },
  { id: "layout-accessibility", label: "Layout or accessibility" },
  { id: "other", label: "Other" },
] as const;

function stopById(stopId: string | null): MathStop | null {
  return REQUIRED_STOPS.find(({ id }) => id === stopId) ?? null;
}

function questionNeedsOpenCard(question: WorldQuestion): boolean {
  return (
    question.presentation === "source-card" ||
    question.choices.some(choice => choice.visualOnly) ||
    /\b(shown|picture|drawing|diagram|tracks|figure|below|above|card|clock)\b/i.test(
      question.prompt,
    )
  );
}

export default function MathWorldClient() {
  const [progress, setProgress] = useState<WorldProgress>(createInitialProgress);
  const [hydrated, setHydrated] = useState(false);
  const [qaUnlocked, setQaUnlocked] = useState(false);
  const [selectedBoss, setSelectedBoss] = useState<BossChallenge | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [inspectedStopId, setInspectedStopId] = useState<string | null>(null);
  const [lastVisitedStopId, setLastVisitedStopId] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [qaOpen, setQaOpen] = useState(false);
  const [qaStatus, setQaStatus] = useState<"looks-good" | "needs-change">("looks-good");
  const [qaCategories, setQaCategories] = useState<readonly QaCategory[]>([]);
  const [qaNote, setQaNote] = useState("");
  const audioRef = useRef<AudioContext | null>(null);
  const answerRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const closeInspectRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const playtestMode = readWorldPlaytestMode() || new URLSearchParams(window.location.search).get("qa") === "1";
      const savedProgress = readWorldProgress(playtestMode);
      const requestedBoss = bossById(new URLSearchParams(window.location.search).get("boss"));
      const initialBoss = requestedBoss && canOpenBoss(savedProgress, requestedBoss, playtestMode) ? requestedBoss : null;
      setQaUnlocked(playtestMode);
      setProgress(savedProgress);
      setSelectedBoss(initialBoss);
      const initialUrl = new URL(window.location.href);
      if (!initialBoss) initialUrl.searchParams.delete("boss");
      window.history.replaceState({ ...window.history.state, mathWorldId: savedProgress.selectedWorldId }, "", initialUrl);
      setSoundEnabled(readSoundPreference());
      setHydrated(true);
      window.scrollTo({ top: 0, behavior: "auto" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (hydrated) writeWorldProgress(progress, qaUnlocked);
  }, [hydrated, progress, qaUnlocked]);

  useEffect(() => {
    if (!hydrated) return;
    const syncProfile = () => {
      const next = readWorldPlaytestMode() || new URLSearchParams(window.location.search).get("qa") === "1";
      const nextProgress = next !== qaUnlocked ? readWorldProgress(next) : progress;
      if (next !== qaUnlocked) {
        setQaUnlocked(next);
        setProgress(nextProgress);
        setInspectedStopId(null);
        setLastVisitedStopId(null);
        setQaOpen(false);
        setZoomed(false);
      }
      if (selectedBoss && !canOpenBoss(nextProgress, selectedBoss, next)) {
        setSelectedBoss(null);
        const url = new URL(window.location.href);
        url.searchParams.delete("boss");
        window.history.replaceState({ ...window.history.state, mathWorldId: nextProgress.selectedWorldId }, "", url);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === "spatial-gym:progression") syncProfile();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", syncProfile);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", syncProfile);
    };
  }, [hydrated, qaUnlocked, progress, selectedBoss]);

  useEffect(() => {
    if (!hydrated) return;
    const restoreDestination = (event: PopStateEvent) => {
      const params = new URLSearchParams(window.location.search);
      const nextQa = readWorldPlaytestMode() || params.get("qa") === "1";
      const nextProgress = nextQa !== qaUnlocked ? readWorldProgress(nextQa) : progress;
      if (nextQa !== qaUnlocked) {
        setQaUnlocked(nextQa);
        setProgress(nextProgress);
      }
      const requestedBossId = params.get("boss");
      const requestedBoss = bossById(requestedBossId);
      const allowedBoss = requestedBoss && canOpenBoss(nextProgress, requestedBoss, nextQa) ? requestedBoss : null;
      setSelectedBoss(allowedBoss);
      setInspectedStopId(null);
      setLastVisitedStopId(null);
      setQaOpen(false);
      setZoomed(false);
      if (!allowedBoss) {
        const url = new URL(window.location.href);
        url.searchParams.delete("boss");
        const worldId = event.state?.mathWorldId;
        if (!requestedBossId && typeof worldId === "string" && canOpenWorld(nextProgress, worldId, nextQa)) {
          setProgress(current => current.selectedWorldId === worldId ? current : selectWorld(current, worldId, nextQa));
        }
        window.history.replaceState(window.history.state, "", url);
      }
      window.scrollTo({ top: 0, behavior: "auto" });
    };
    window.addEventListener("popstate", restoreDestination);
    return () => window.removeEventListener("popstate", restoreDestination);
  }, [hydrated, progress, qaUnlocked]);

  const activeStop = selectedBoss ? null : stopById(progress.activeStopId);
  const selectedWorld = (activeStop ? worldForStop(activeStop.id) : undefined)
    ?? WORLD_DEFINITIONS.find(({ id }) => id === progress.selectedWorldId)
    ?? WORLD_DEFINITIONS[0];
  const questions = activeStop
    ? (QUESTIONS_BY_STOP.get(activeStop.id) ?? [])
    : [];
  const attempt = activeStop ? progress.stopAttempts[activeStop.id] : undefined;
  const question = attempt
    ? questions[Math.min(attempt.questionIndex, Math.max(questions.length - 1, 0))]
    : undefined;

  useEffect(() => {
    if (!activeStop || !attempt || attempt.phase !== "wrong-review") return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timeout = window.setTimeout(
      () => setProgress((current) => allowRetry(current, activeStop.id)),
      reducedMotion ? 1300 : 2200,
    );
    return () => window.clearTimeout(timeout);
  }, [activeStop, attempt]);

  useEffect(() => {
    if (!attempt) return;
    if (attempt.phase === "correct") {
      nextRef.current?.focus({ preventScroll: true });
      return;
    }
    if (attempt.phase === "answering") {
      answerRefs.current[0]?.focus({ preventScroll: true });
      return;
    }
    if (attempt.phase === "retry" && attempt.selectedIndex !== null) {
      answerRefs.current[attempt.selectedIndex]?.focus({ preventScroll: true });
    }
  }, [attempt]);

  useEffect(() => {
    if (!inspectedStopId) return;
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeInspectRef.current?.focus();
    return () => origin?.focus({ preventScroll: true });
  }, [inspectedStopId]);

  function ensureAudio(): AudioContext | null {
    if (!soundEnabled) return null;
    const context = audioRef.current ?? createGameAudioContext();
    audioRef.current = context;
    if (context?.state === "suspended") void context.resume().catch(() => undefined);
    return context;
  }

  function handleAnswer(selectedIndex: number) {
    if (!question || selectedIndex < 0 || selectedIndex >= question.choices.length) return;
    if (!activeStop || !question || !attempt || !["answering", "retry"].includes(attempt.phase)) {
      return;
    }
    const correct = selectedIndex === question.correctIndex;
    rememberFirstQaSelection(question.id, activeStop.id, selectedIndex);
    const context = ensureAudio();
    if (context) playFeedbackEarcon(context, correct);
    setProgress((current) =>
      answerQuestion(current, activeStop.id, question, selectedIndex),
    );
  }

  useEffect(() => {
    if (zoomed || qaOpen || inspectedStopId || !activeStop || !question || !attempt || !["answering", "retry"].includes(attempt.phase)) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.matches("input, textarea, select, [contenteditable='true']") ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }
      const normalized = event.key.toUpperCase();
      const index = LETTERS.indexOf(normalized as (typeof LETTERS)[number]);
      const numberIndex = Number.parseInt(event.key, 10) - 1;
      const selectedIndex = index >= 0 ? index : numberIndex;
      if (selectedIndex >= 0 && selectedIndex < question.choices.length) {
        event.preventDefault();
        handleAnswer(selectedIndex);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function toggleSound() {
    const next = !soundEnabled;
    setSoundEnabled(next);
    writeSoundPreference(next);
    if (next) ensureAudio();
  }

  function resetViewport() {
    window.requestAnimationFrame(() => {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
    });
  }

  function openStop(stopId: string) {
    setInspectedStopId(null);
    setLastVisitedStopId(stopId);
    setProgress((current) => startStop(current, stopId, qaUnlocked));
    resetViewport();
  }

  function chooseWorld(worldId: string) {
    if (!canOpenWorld(progress, worldId, qaUnlocked)) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("boss");
    window.history.pushState({ ...window.history.state, mathWorldId: worldId }, "", url);
    setSelectedBoss(null);
    setInspectedStopId(null);
    setLastVisitedStopId(null);
    setQaOpen(false);
    setZoomed(false);
    setProgress((current) => selectWorld(current, worldId, qaUnlocked));
    resetViewport();
  }

  function chooseBoss(challenge: BossChallenge) {
    if (!canOpenBoss(progress, challenge, qaUnlocked)) return;
    const url = new URL(window.location.href);
    url.searchParams.set("boss", challenge.id);
    window.history.pushState({ ...window.history.state, mathWorldId: progress.selectedWorldId }, "", url);
    setSelectedBoss(challenge);
    setInspectedStopId(null);
    setLastVisitedStopId(null);
    setQaOpen(false);
    setZoomed(false);
    resetViewport();
  }

  function goToMap() {
    if (activeStop) setLastVisitedStopId(activeStop.id);
    setProgress((current) => ({ ...leaveCheckpoint(current), activeStopId: null }));
    resetViewport();
  }

  function goToNextQuestion() {
    if (!activeStop) return;
    setProgress((current) => advanceQuestion(current, activeStop.id, questions.length));
    resetViewport();
  }

  function openQa() {
    if (!question || !activeStop) return;
    const existing = readQaArchive().records[question.id];
    setQaStatus(existing?.status ?? "looks-good");
    setQaCategories(existing?.categories ?? []);
    setQaNote(existing?.note ?? "");
    setQaOpen(true);
  }

  function saveQa() {
    if (!question || !activeStop) return;
    const existing = readQaArchive().records[question.id];
    writeQaRecord({
      questionId: question.id,
      stopId: activeStop.id,
      categories: qaCategories,
      note: qaNote.trim(),
      status: qaStatus,
      firstSelectedIndex: existing?.firstSelectedIndex ?? null,
      updatedAt: new Date().toISOString(),
    });
    setQaOpen(false);
  }

  function toggleQaCategory(event: ChangeEvent<HTMLInputElement>, category: QaCategory) {
    setQaCategories((current) =>
      event.target.checked
        ? [...new Set([...current, category])]
        : current.filter((value) => value !== category),
    );
  }

  if (!hydrated) {
    return (
      <main className={styles.loadingShell}>
        <span className={styles.loadingKangaroo} aria-hidden="true">⌁</span>
        <p>Opening your adventure…</p>
      </main>
    );
  }

  const inspectedStop = stopById(inspectedStopId);
  const inspectedQuestions = inspectedStop
    ? (QUESTIONS_BY_STOP.get(inspectedStop.id) ?? [])
    : [];
  const inspectedAttempt = inspectedStop
    ? progress.stopAttempts[inspectedStop.id]
    : undefined;

  return (
    <div className={styles.app}>
      <header className={styles.topBar}>
        <Link className={styles.homeLink} href="/" aria-label="Spatial Gym home">
          <span aria-hidden="true">←</span> Spatial Gym
        </Link>
        <div className={styles.worldBrand}>
          <span aria-hidden="true">◒</span>
          <strong>Math Kangaroo Worlds</strong>
        </div>
        <div className={styles.topActions}>
          {qaUnlocked && <span className={styles.headerTestBadge}>Test mode</span>}
          {activeStop && (
            <button type="button" className={styles.mapButton} onClick={goToMap}>
              Map
            </button>
          )}
          <button
            type="button"
            className={styles.soundButton}
            aria-pressed={soundEnabled}
            aria-label={`Sound ${soundEnabled ? "on" : "off"}`}
            onClick={toggleSound}
          >
            <span aria-hidden="true">{soundEnabled ? "♪" : "×"}</span>
            <span className={styles.soundLabel}>Sound {soundEnabled ? "on" : "off"}</span>
          </button>
        </div>
      </header>

      {!activeStop && WORLD_MODE === "spiral-preview" ? (
        <GlobeAdventure key={qaUnlocked ? "playtest-globe" : "adventure-globe"}
          world={selectedWorld} boss={selectedBoss} progress={progress} qaUnlocked={qaUnlocked}
          avatarStopId={lastVisitedStopId} onChooseWorld={chooseWorld} onChooseBoss={chooseBoss}
          onOpenStop={openStop} onInspectStop={setInspectedStopId} onExportQa={downloadQaArchive} />
      ) : selectedBoss ? (
        <BossWorld key={`${qaUnlocked ? "playtest" : "adventure"}:${selectedBoss.id}`}
          challenge={selectedBoss} progress={progress} qaUnlocked={qaUnlocked}
          onChooseWorld={chooseWorld} onChooseBoss={chooseBoss} />
      ) : activeStop && question && attempt ? (
        <main className={styles.courseShell}>
          <section className={styles.courseTopline} aria-label="Stop progress">
            <div>
              <p className={styles.kicker}>World {selectedWorld.number} · {selectedWorld.concept} {selectedWorld.spiral}</p>
              <h1>{activeStop.label}</h1>
            </div>
            <div className={styles.questionProgress}>
              <span>Question {attempt.questionIndex + 1} of {questions.length}</span>
              <div
                className={styles.progressTrack}
                role="progressbar"
                aria-label={`${activeStop.label} question progress`}
                aria-valuemin={1}
                aria-valuemax={questions.length}
                aria-valuenow={attempt.questionIndex + 1}
              >
                <span style={{ width: `${((attempt.questionIndex + 1) / questions.length) * 100}%` }} />
              </div>
            </div>
          </section>

          <section className={styles.questionPanel} aria-labelledby="question-heading">
            <div className={styles.questionHeader}>
              <div>
                <span className={styles.sourcePill}>{question.source.sourceKind === "practice" ? "Practice" : question.source.sourceKind === "mock" ? "Mock test" : "Math Kangaroo"} · {question.source.year}</span>
                <h2 id="question-heading">Choose the best answer.</h2>
              </div>
              <button type="button" className={styles.flagButton} onClick={openQa}>
                Flag question
              </button>
            </div>

            <p className={question.presentation === "semantic" || question.showPrompt ? styles.questionPrompt : styles.srOnly}>
              {question.prompt}
            </p>

            <details
              key={question.id}
              className={styles.sourceCardDetails}
              open={questionNeedsOpenCard(question)}
            >
              <summary>
                {question.presentation === "semantic" ? "View original question card" : "Original question card"}
              </summary>
              <button
                type="button"
                className={styles.sourceCardButton}
                onClick={() => setZoomed(true)}
                aria-label="Open the original question card larger"
              >
                <Image
                  className={styles.sourceImage}
                  src={`${basePath}${question.asset.src}`}
                  alt={question.asset.alt}
                  width={question.asset.width}
                  height={question.asset.height}
                  unoptimized
                  priority
                />
                <span className={styles.zoomHint} aria-hidden="true">＋ Open larger</span>
              </button>
            </details>

            <div className={styles.answerGrid} style={{ "--answer-count": question.choices.length } as CSSProperties} aria-label="Answer choices">
              {question.choices.map((choice, index) => {
                const selected = attempt.selectedIndex === index;
                const correct = attempt.phase === "correct" && index === question.correctIndex;
                const wrong = selected && attempt.firstTryCorrect[question.id] === false && !correct;
                return (
                  <button
                    key={`${question.id}-${index}`}
                    ref={(element) => { answerRefs.current[index] = element; }}
                    type="button"
                    className={styles.answerButton}
                    data-correct={correct || undefined}
                    data-wrong={wrong || undefined}
                    data-muted={attempt.phase === "correct" && !correct || undefined}
                    disabled={attempt.phase === "wrong-review" || attempt.phase === "correct"}
                    onClick={() => handleAnswer(index)}
                    aria-label={choice.accessibleLabel}
                    aria-keyshortcuts={`${index + 1} ${LETTERS[index]}`}
                  >
                    <span className={styles.answerLetter}>{LETTERS[index]}</span>
                    <span className={styles.answerContent}>{choice.label}</span>
                    <span className={styles.answerMark} aria-hidden="true">
                      {correct ? "✓" : wrong ? "×" : ""}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className={styles.feedbackRegion} aria-live="polite">
              {attempt.phase === "wrong-review" && (
                <p className={styles.wrongFeedback}><strong>Not quite ×</strong> Take a close look. Try another choice in a moment.</p>
              )}
              {attempt.phase === "retry" && (
                <p className={styles.retryFeedback}><strong>Try again.</strong> Your first result is saved; this question stays here until it clicks.</p>
              )}
              {attempt.phase === "correct" && (
                <div className={styles.correctFeedback}>
                  <p><strong>Correct ✓</strong> You found the answer.</p>
                  <button
                    ref={nextRef}
                    type="button"
                    className={styles.primaryButton}
                    onClick={goToNextQuestion}
                  >
                    {attempt.questionIndex === questions.length - 1 ? "Finish stop" : "Next question"}
                    <span aria-hidden="true">→</span>
                  </button>
                </div>
              )}
            </div>
          </section>

          <p className={styles.keyboardHint}>Keyboard: press A–{LETTERS[question.choices.length - 1]} or 1–{question.choices.length} to answer.</p>
        </main>
      ) : (
        <WorldMap
          key={`${qaUnlocked ? "playtest" : "adventure"}:${selectedWorld.id}`}
          world={selectedWorld}
          onChooseWorld={chooseWorld}
          onChooseBoss={chooseBoss}
          avatarStopId={lastVisitedStopId}
          progress={progress}
          qaUnlocked={qaUnlocked}
          onOpenStop={openStop}
          onInspectStop={setInspectedStopId}
          onExportQa={downloadQaArchive}
        />
      )}

      {inspectedStop && (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => setInspectedStopId(null)}>
          <section
            className={styles.completedDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="completed-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button ref={closeInspectRef} type="button" className={styles.dialogClose} onClick={() => setInspectedStopId(null)} aria-label="Close stop summary">×</button>
            <span className={styles.completedSeal} aria-hidden="true">✓</span>
            <p className={styles.kicker}>Completed stop</p>
            <h2 id="completed-dialog-title">{inspectedStop.label}</h2>
            <p>{inspectedStop.description}</p>
            <strong className={styles.dialogAccuracy}>{stopFirstTryAccuracy(inspectedAttempt, inspectedQuestions)}% first-try accuracy</strong>
          </section>
        </div>
      )}

      {zoomed && question && (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => setZoomed(false)}>
          <section className={styles.zoomDialog} role="dialog" aria-modal="true" aria-label="Larger original question card" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className={styles.dialogClose} onClick={() => setZoomed(false)} aria-label="Close larger question card">×</button>
            <div className={styles.zoomScroller}>
              {/* A native image preserves the source crop at its exact authored dimensions. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${basePath}${question.asset.src}`} width={question.asset.width} height={question.asset.height} alt={question.asset.alt} />
            </div>
          </section>
        </div>
      )}

      {qaOpen && question && (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => setQaOpen(false)}>
          <section className={styles.qaDialog} role="dialog" aria-modal="true" aria-labelledby="qa-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className={styles.dialogClose} onClick={() => setQaOpen(false)} aria-label="Close playtest note">×</button>
            <p className={styles.kicker}>Playtest note</p>
            <h2 id="qa-dialog-title">How did this question feel?</h2>
            <div className={styles.qaStatusChoice}>
              <label><input type="radio" name="qa-status" checked={qaStatus === "looks-good"} onChange={() => setQaStatus("looks-good")} /> Looks good</label>
              <label><input type="radio" name="qa-status" checked={qaStatus === "needs-change"} onChange={() => setQaStatus("needs-change")} /> Needs a change</label>
            </div>
            <fieldset>
              <legend>What should we inspect?</legend>
              <div className={styles.qaCategoryGrid}>
                {QA_CATEGORIES.map((category) => (
                  <label key={category.id}>
                    <input type="checkbox" checked={qaCategories.includes(category.id)} onChange={(event) => toggleQaCategory(event, category.id)} />
                    {category.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className={styles.noteField}>
              Notes
              <textarea value={qaNote} onChange={(event) => setQaNote(event.target.value)} rows={4} placeholder="What did you notice?" />
            </label>
            <button type="button" className={styles.primaryButton} onClick={saveQa}>Save note</button>
          </section>
        </div>
      )}

      <footer className={styles.worldFooter}>
        <span>Untimed adventures · Saved on this device</span>
        <span>{qaUnlocked ? "Test mode · progress saved separately" : "Made for curious minds"}</span>
      </footer>
    </div>
  );
}
