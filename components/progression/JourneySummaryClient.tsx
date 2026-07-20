"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  Avatar,
  DEFAULT_AVATAR_ID,
  isAvatarId,
} from "@/components/progression/avatar";
import {
  createGameAudioContext,
  playXpJingle,
  readSoundPreference,
} from "@/lib/game-audio";
import {
  activePlayerProfile,
  buildJourneyPlan,
  closeAttemptSummary,
  findJourneyNode,
  loadProgressionStateDiagnostic,
  nextIncompleteJourneyNode,
  profileXpTotal,
  PROGRESSION_STORAGE_KEY,
  replacePlayerProfile,
  saveProgressionState,
  settleProgressionAttempt,
  summarizeAttempt,
  upsertProfileAttempt,
  type PlayerProfile,
  type ProgressionAttempt,
  type ProgressionState,
} from "@/lib/progression";
import {
  createJourneyAttempt,
  markJourneyArrival,
  navigateToJourney,
  navigateToProgressionAttempt,
} from "./journey-launch";

import styles from "@/app/journey/journey.module.css";

type LoadedSummary = {
  state: ProgressionState;
  profile: PlayerProfile;
  attempt: ProgressionAttempt;
};

function isSummaryAttempt(attempt: ProgressionAttempt): boolean {
  return (
    attempt.phase === "summary-ready" ||
    attempt.phase === "summary" ||
    attempt.phase === "retry-required"
  );
}

function formatDuration(durationMs: number) {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes === 0
    ? `${remainder}s`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function readSummary(): LoadedSummary | null {
  const attemptId = new URLSearchParams(window.location.search).get("attempt");
  if (!attemptId) return null;
  const loaded = loadProgressionStateDiagnostic();
  if (
    loaded.status === "corrupt" ||
    loaded.status === "unsupported" ||
    loaded.status === "unavailable"
  ) {
    return null;
  }
  const state = loaded.state;
  const activeProfile = activePlayerProfile(state);
  const profile =
    (activeProfile?.attempts[attemptId] ? activeProfile : undefined) ??
    state.profiles.find((candidate) => candidate.attempts[attemptId]);
  const attempt = profile?.attempts[attemptId];
  if (!profile || !attempt || !isSummaryAttempt(attempt)) return null;
  return { state, profile, attempt };
}

function readLatestSummary(
  profileId: string,
  attemptId: string,
): LoadedSummary | null {
  const loaded = loadProgressionStateDiagnostic();
  if (
    loaded.status === "corrupt" ||
    loaded.status === "unsupported" ||
    loaded.status === "unavailable"
  ) {
    return null;
  }
  const state = loaded.state;
  const profile = state.profiles.find(({ id }) => id === profileId);
  const attempt = profile?.attempts[attemptId];
  return profile && attempt && isSummaryAttempt(attempt)
    ? { state, profile, attempt }
    : null;
}

function playAwardSound() {
  if (!readSoundPreference()) return;
  const context = createGameAudioContext();
  if (!context) return;
  const play = () => {
    playXpJingle(context);
    window.setTimeout(() => {
      void context.close().catch(() => undefined);
    }, 600);
  };
  if (context.state === "suspended") {
    void context.resume().then(play).catch(() => undefined);
  } else if (context.state === "running") {
    play();
  }
}

export function JourneySummaryClient() {
  const [loaded, setLoaded] = useState<LoadedSummary | null | undefined>();
  const [storageWarning, setStorageWarning] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const summaryTitleRef = useRef<HTMLHeadingElement>(null);
  const focusedAttemptRef = useRef<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setLoaded(readSummary()), 0);
    function syncStorage(event: StorageEvent) {
      if (event.key === PROGRESSION_STORAGE_KEY || event.key === null) {
        setLoaded(readSummary());
      }
    }
    window.addEventListener("storage", syncStorage);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("storage", syncStorage);
    };
  }, []);

  const preview = useMemo(() => {
    if (!loaded) return null;
    const { profile, attempt } = loaded;
    const journey = buildJourneyPlan(profile.gameSnapshot);
    const node = findJourneyNode(journey, attempt.stopId);
    if (!node) return null;
    const basic = attempt.settlement ?? summarizeAttempt(attempt);
    const xpAwarded =
      basic.passed && !profile.awardedStopIds.includes(node.id) ? node.xp : 0;
    return {
      node,
      settlement: attempt.settlement ?? { ...basic, xpAwarded },
    };
  }, [loaded]);

  useEffect(() => {
    const attemptId = loaded?.attempt.id;
    if (!attemptId || !preview || focusedAttemptRef.current === attemptId) return;
    focusedAttemptRef.current = attemptId;
    const frame = window.requestAnimationFrame(() => {
      summaryTitleRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loaded?.attempt.id, preview]);

  if (loaded === undefined) {
    return (
      <div className={styles.page}>
        <main className={styles.loading}>Preparing your celebration…</main>
      </div>
    );
  }

  if (loaded === null || preview === null) {
    return (
      <div className={styles.page}>
        <main className={styles.summaryPage}>
          <section className={styles.summaryCard}>
            <p className={styles.kicker}>Journey recovery</p>
            <h1>Let’s find your place.</h1>
            <p className={styles.lede}>
              This result is no longer available, but your saved trail is
              waiting on the Journey map.
            </p>
            <div className={styles.summaryActions}>
              <Link className={styles.primaryButton} href="/journey/">
                Journey map
              </Link>
            </div>
          </section>
        </main>
      </div>
    );
  }

  const { profile, attempt } = loaded;
  const { node, settlement } = preview;
  const settled =
    attempt.phase === "summary" ||
    attempt.phase === "retry-required";
  const passed = settlement.passed;
  const isCulmination = node.kind === "culmination";
  const isFinalMastery = isCulmination && node.level === "wizard";
  const avatarId = isAvatarId(profile.avatarId)
    ? profile.avatarId
    : DEFAULT_AVATAR_ID;
  const title = passed
    ? isFinalMastery
      ? "Journey mastered!"
      : isCulmination
        ? `${profile.name} leveled up!`
        : settlement.accuracy === 1
          ? "Brilliant work!"
          : "Trail cleared!"
    : "You finished strong!";
  const message = passed
    ? isCulmination
      ? isFinalMastery
        ? "Four boards, every challenge, and a mountain of brave practice. That deserves a celebration."
        : "Every skill on this board came together. Your next trail is ready whenever you are."
      : "Every question is complete, every miss is redeemed, and the next stop is ready."
    : "You completed the whole stop and made every miss right. One more pass will make this trail feel familiar.";

  function settle() {
    if (settled) return;
    try {
      const latest = readLatestSummary(profile.id, attempt.id);
      if (!latest) {
        setStorageWarning(true);
        return;
      }
      if (latest.attempt.phase !== "summary-ready") {
        setLoaded(latest);
        setAnnouncement("This result is already up to date.");
        return;
      }
      const result = settleProgressionAttempt(
        latest.profile,
        latest.attempt,
      );
      const nextState = replacePlayerProfile(latest.state, result.profile);
      if (!saveProgressionState(nextState)) {
        setStorageWarning(true);
        return;
      }
      setLoaded({
        state: nextState,
        profile: result.profile,
        attempt: result.attempt,
      });
      setAnnouncement(
        result.settlement.xpAwarded > 0
          ? `${result.settlement.xpAwarded} XP added.`
          : result.settlement.passed
            ? "Practice complete."
            : "Attempt saved. This stop is ready to try again.",
      );
      if (result.settlement.xpAwarded > 0) playAwardSound();
    } catch {
      setStorageWarning(true);
    }
  }

  function continueJourney() {
    const latest = readLatestSummary(profile.id, attempt.id);
    if (!latest) {
      setStorageWarning(true);
      return;
    }
    const currentProfile = latest.profile;
    const currentAttempt = latest.attempt;
    if (
      currentAttempt.phase !== "summary" &&
      currentAttempt.phase !== "retry-required"
    ) {
      return;
    }
    try {
      const closedProfile = closeAttemptSummary(
        currentProfile,
        currentAttempt.id,
      );
      const practiceReplay =
        currentAttempt.phase === "retry-required" &&
        currentProfile.clearedStopIds.includes(currentAttempt.stopId);
      if (currentAttempt.phase === "retry-required" && !practiceReplay) {
        const journey = buildJourneyPlan(closedProfile.gameSnapshot);
        const retryNode = findJourneyNode(journey, currentAttempt.stopId);
        if (!retryNode) throw new Error("Retry stop is no longer available.");
        const retryAttempt = createJourneyAttempt(closedProfile, retryNode);
        const retryProfile = upsertProfileAttempt(
          closedProfile,
          retryAttempt,
        );
        const nextState = replacePlayerProfile(latest.state, retryProfile);
        if (!saveProgressionState(nextState)) {
          setStorageWarning(true);
          return;
        }
        navigateToProgressionAttempt(retryAttempt);
        return;
      }

      const nextState = replacePlayerProfile(latest.state, closedProfile);
      if (!saveProgressionState(nextState)) {
        setStorageWarning(true);
        return;
      }
      if (currentAttempt.phase === "summary") {
        const nextNode = nextIncompleteJourneyNode(closedProfile);
        if (nextNode) markJourneyArrival(closedProfile.id, nextNode.id);
      }
      navigateToJourney();
    } catch {
      setStorageWarning(true);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" aria-label="Spatial Gym home">
          <span className={styles.brandMark} aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>Spatial Gym</span>
        </Link>
        <span className={styles.xpPill} aria-label={`${profileXpTotal(profile)} total XP`}>
          <span aria-hidden="true">✦</span>
          <b>{profileXpTotal(profile)}</b> XP
        </span>
      </header>
      <main className={styles.summaryPage}>
        <section className={styles.summaryCard} aria-labelledby="summary-title">
          <div className={styles.summaryAvatar}>
            <Avatar
              avatar={avatarId}
              size="hero"
              state={isCulmination && passed ? "level-up" : "celebrating"}
              label={`${profile.name}'s ${avatarId} avatar celebrating`}
              eager
            />
          </div>
          <p className={styles.kicker}>
            {passed ? "Stop complete" : "Practice complete"}
          </p>
          <h1 id="summary-title" ref={summaryTitleRef} tabIndex={-1}>
            {title}
          </h1>
          <p className={styles.lede}>{message}</p>

          <div className={styles.summaryStats}>
            <div className={styles.summaryStat}>
              <span>XP</span>
              <strong>
                {settlement.xpAwarded > 0
                  ? `+${settlement.xpAwarded}`
                  : "—"}
              </strong>
            </div>
            <div className={styles.summaryStat}>
              <span>First-try accuracy</span>
              <strong>{settlement.accuracyPercent}%</strong>
            </div>
            <div className={styles.summaryStat}>
              <span>Active time</span>
              <strong>{formatDuration(settlement.activeTimeMs)}</strong>
            </div>
          </div>

          {storageWarning ? (
            <p className={styles.storageWarning} role="alert">
              This result could not be saved. Free space or allow site storage,
              then try again.
            </p>
          ) : null}
          <p role="status" aria-live="polite">
            {announcement}
          </p>

          <div className={styles.summaryActions}>
            {!settled ? (
              <button className={styles.primaryButton} type="button" onClick={settle}>
                {settlement.xpAwarded > 0
                  ? `Claim ${settlement.xpAwarded} XP`
                  : passed
                    ? "Finish stop"
                    : "Save this practice"}
              </button>
            ) : (
              <button
                className={styles.primaryButton}
                type="button"
                onClick={continueJourney}
              >
                {passed
                  ? isFinalMastery
                    ? "Back to the full Journey"
                    : isCulmination
                      ? "See the next level"
                      : "Continue Journey"
                  : profile.clearedStopIds.includes(node.id)
                    ? "Back to Journey"
                    : "Try this stop again"}
                <span aria-hidden="true">→</span>
              </button>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
