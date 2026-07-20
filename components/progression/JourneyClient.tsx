"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";

import {
  AVATAR_OPTIONS,
  Avatar,
  DEFAULT_AVATAR_ID,
  isAvatarId,
  type AvatarId,
} from "@/components/progression/avatar";
import {
  createGameAudioContext,
  readSoundPreference,
  writeSoundPreference,
} from "@/lib/game-audio";
import { games } from "@/lib/games";
import {
  PROGRESSION_LEVELS,
  PROGRESSION_STORAGE_KEY,
  activePlayerProfile,
  addPlayerProfile,
  buildJourneyPlan,
  createPlayerProfile,
  createProgressionState,
  deletePlayerProfile,
  discardActiveProgressionAttempt,
  findJourneyNode,
  isJourneyNodeUnlocked,
  loadProgressionStateDiagnostic,
  nextIncompleteJourneyNode,
  profileXpTotal,
  removeProgressionState,
  replacePlayerProfile,
  saveProgressionState,
  switchPlayerProfile,
  updatePlayerProfileIdentity,
  upsertProfileAttempt,
  type JourneyNode,
  type PlayerProfile,
  type ProgressionLevel,
  type ProgressionLoadStatus,
  type ProgressionState,
} from "@/lib/progression";
import {
  createJourneyAttempt,
  consumeJourneyArrival,
  journeyCatalogSnapshot,
  navigateToProgressionAttempt,
} from "./journey-launch";

import styles from "@/app/journey/journey.module.css";

function levelLabel(level: ProgressionLevel) {
  return `${level.slice(0, 1).toUpperCase()}${level.slice(1)}`;
}

function profileId() {
  try {
    return window.crypto.randomUUID();
  } catch {
    return `profile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function AvatarPicker({
  value,
  onChange,
}: {
  value: AvatarId;
  onChange: (avatar: AvatarId) => void;
}) {
  return (
    <fieldset className={styles.avatarFieldset}>
      <legend className={styles.avatarLegend}>Choose an animal</legend>
      <div className={styles.avatarGrid}>
        {AVATAR_OPTIONS.map((option) => {
          const selected = option.id === value;
          return (
            <button
              className={`${styles.avatarOption} ${
                selected ? styles.avatarOptionSelected : ""
              }`}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.id)}
              key={option.id}
            >
              <Avatar avatar={option.id} size={58} decorative />
              <span>{option.name}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function ProfileForm({
  heading,
  initialName = "",
  initialAvatar = DEFAULT_AVATAR_ID,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  heading: string;
  initialName?: string;
  initialAvatar?: AvatarId;
  submitLabel: string;
  onSubmit: (name: string, avatarId: AvatarId) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [avatarId, setAvatarId] = useState<AvatarId>(initialAvatar);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit(trimmed, avatarId);
  }

  return (
    <section className={styles.onboarding} aria-labelledby="profile-form-title">
      <div className={styles.onboardingCard}>
        <p className={styles.kicker}>Your local player</p>
        <h1 id="profile-form-title">{heading}</h1>
        <p className={styles.lede}>
          Pick a name and a trail buddy. Progress stays only on this device,
          and you can add or switch players whenever you like.
        </p>
        <form className={styles.profileForm} onSubmit={submit}>
          <div className={styles.field}>
            <label htmlFor="journey-profile-name">Player name</label>
            <input
              id="journey-profile-name"
              name="name"
              value={name}
              maxLength={24}
              autoComplete="nickname"
              autoFocus
              required
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <AvatarPicker value={avatarId} onChange={setAvatarId} />
          <div className={styles.formActions}>
            <button className={styles.primaryButton} type="submit">
              {submitLabel} <span aria-hidden="true">→</span>
            </button>
            {onCancel ? (
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={onCancel}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </section>
  );
}

function JourneyTopbar({
  profile,
  xp,
  soundEnabled,
  onToggleSound,
  onOpenProfiles,
}: {
  profile?: PlayerProfile;
  xp: number;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onOpenProfiles: () => void;
}) {
  const avatarId = isAvatarId(profile?.avatarId)
    ? profile.avatarId
    : DEFAULT_AVATAR_ID;
  return (
    <header className={styles.topbar}>
      <Link className={styles.brand} href="/" aria-label="Spatial Gym home">
        <span className={styles.brandMark} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span>Spatial Gym</span>
      </Link>
      <div className={styles.topActions}>
        {profile ? (
          <span className={styles.xpPill} aria-label={`${xp} total XP`}>
            <span aria-hidden="true">✦</span>
            <b>{xp}</b> XP
          </span>
        ) : null}
        <button
          className={styles.soundButton}
          type="button"
          aria-label="Journey sound"
          aria-pressed={soundEnabled}
          onClick={onToggleSound}
        >
          <span aria-hidden="true">{soundEnabled ? "♪" : "♪̸"}</span>
        </button>
        {profile ? (
          <button
            className={styles.profileButton}
            type="button"
            onClick={onOpenProfiles}
            aria-haspopup="dialog"
            data-profile-trigger
          >
            <Avatar avatar={avatarId} size={34} decorative />
            <span>{profile.name}</span>
          </button>
        ) : null}
      </div>
    </header>
  );
}

function ProfilePanel({
  state,
  profile,
  onChangeState,
  onClose,
  onCreate,
}: {
  state: ProgressionState;
  profile: PlayerProfile;
  onChangeState: (next: ProgressionState) => boolean;
  onClose: () => void;
  onCreate: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [name, setName] = useState(profile.name);
  const [avatarId, setAvatarId] = useState<AvatarId>(
    isAvatarId(profile.avatarId) ? profile.avatarId : DEFAULT_AVATAR_ID,
  );

  useEffect(() => {
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), a[href]",
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function saveIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    onChangeState(
      replacePlayerProfile(
        state,
        updatePlayerProfileIdentity(profile, {
          name,
          avatarId,
        }),
      ),
    );
  }

  function removeProfile() {
    if (
      !window.confirm(
        `Delete ${profile.name} and all of this player's Journey progress?`,
      )
    ) {
      return;
    }
    if (onChangeState(deletePlayerProfile(state, profile.id))) {
      onClose();
    }
  }

  return (
    <div className={styles.profileScrim}>
      <section
        className={styles.profilePanel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="profiles-title"
        ref={panelRef}
      >
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.kicker}>This device</p>
            <h2 id="profiles-title">Players</h2>
          </div>
          <button
            className={styles.iconButton}
            type="button"
            aria-label="Close player menu"
            onClick={onClose}
            ref={closeRef}
          >
            ×
          </button>
        </div>

        <ul className={styles.profileList}>
          {state.profiles.map((candidate) => {
            const candidateAvatar = isAvatarId(candidate.avatarId)
              ? candidate.avatarId
              : DEFAULT_AVATAR_ID;
            const active = candidate.id === profile.id;
            return (
              <li key={candidate.id}>
                <button
                  className={`${styles.profileChoice} ${
                    active ? styles.profileChoiceActive : ""
                  }`}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    onChangeState(switchPlayerProfile(state, candidate.id))
                  }
                >
                  <Avatar avatar={candidateAvatar} size={46} decorative />
                  <span>
                    <strong>{candidate.name}</strong>
                    <small>{profileXpTotal(candidate)} XP</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <form className={styles.profileEdit} onSubmit={saveIdentity}>
          <div className={styles.field}>
            <label htmlFor="edit-profile-name">Name</label>
            <input
              id="edit-profile-name"
              value={name}
              maxLength={24}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <AvatarPicker value={avatarId} onChange={setAvatarId} />
          <div className={styles.formActions}>
            <button className={styles.primaryButton} type="submit">
              Save player
            </button>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={onCreate}
            >
              Add player
            </button>
          </div>
          <button
            className={styles.dangerButton}
            type="button"
            onClick={removeProfile}
          >
            Delete this player
          </button>
        </form>
      </section>
    </div>
  );
}

function nodeAlignment(index: number) {
  return [styles.nodeLeft, styles.nodeCenter, styles.nodeRight][index % 3];
}

function finalJourneyNode(
  journey: ReturnType<typeof buildJourneyPlan>,
): JourneyNode | undefined {
  const finalBoard = journey.boards[journey.boards.length - 1];
  return finalBoard?.nodes[finalBoard.nodes.length - 1];
}

function walkerTravelStyle(index: number): CSSProperties {
  const position = index % 3;
  const horizontal =
    index === 0
      ? "0px"
      : position === 0
        ? "clamp(170px, 52vw, 390px)"
        : "calc(-1 * clamp(84px, 26vw, 195px))";
  const midpoint =
    index === 0
      ? "0px"
      : position === 0
        ? "clamp(76px, 24vw, 180px)"
        : "calc(-1 * clamp(38px, 12vw, 92px))";
  return {
    "--walker-start-x": horizontal,
    "--walker-start-y": index === 0 ? "-58px" : "-164px",
    "--walker-mid-x": midpoint,
    "--walker-mid-y": index === 0 ? "-24px" : "-82px",
  } as CSSProperties;
}

function JourneyBoard({
  profile,
  viewedLevel,
  arrivalNodeId,
  onViewLevel,
  onLaunch,
  onRestartActive,
}: {
  profile: PlayerProfile;
  viewedLevel: ProgressionLevel;
  arrivalNodeId: string | null;
  onViewLevel: (level: ProgressionLevel) => void;
  onLaunch: (node: JourneyNode) => void;
  onRestartActive: (attemptId: string) => void;
}) {
  const trailItemRef = useRef<HTMLLIElement>(null);
  const trailButtonRef = useRef<HTMLButtonElement>(null);
  const journey = useMemo(
    () => buildJourneyPlan(profile.gameSnapshot),
    [profile.gameSnapshot],
  );
  const board = journey.boards.find(({ level }) => level === viewedLevel)!;
  const nextNode = nextIncompleteJourneyNode(profile, journey);
  const activeAttempt = profile.activeAttemptId
    ? profile.attempts[profile.activeAttemptId]
    : undefined;
  const activeNode = activeAttempt
    ? findJourneyNode(journey, activeAttempt.stopId)
    : undefined;
  const trailNode = activeNode ?? nextNode ?? finalJourneyNode(journey);
  const cleared = new Set(profile.clearedStopIds);
  const completedOnBoard = board.nodes.filter(({ id }) => cleared.has(id)).length;
  const currentBoardLevel = trailNode?.level ?? "wizard";
  const avatarId = isAvatarId(profile.avatarId)
    ? profile.avatarId
    : DEFAULT_AVATAR_ID;
  const shouldRevealTrail = Boolean(
    arrivalNodeId ||
      activeAttempt ||
      profile.clearedStopIds.length > 0,
  );

  useEffect(() => {
    if (
      !shouldRevealTrail ||
      !trailNode ||
      viewedLevel !== trailNode.level ||
      !trailItemRef.current
    ) {
      return;
    }
    trailItemRef.current.scrollIntoView({
      behavior: "auto",
      block: "center",
    });
    if (arrivalNodeId === trailNode.id) {
      const frame = window.requestAnimationFrame(() => {
        trailButtonRef.current?.focus({ preventScroll: true });
      });
      return () => window.cancelAnimationFrame(frame);
    }
  }, [
    activeAttempt,
    arrivalNodeId,
    shouldRevealTrail,
    trailNode,
    viewedLevel,
  ]);

  return (
    <main className={styles.board}>
      <nav className={styles.boardTabs} aria-label="Journey boards">
        {PROGRESSION_LEVELS.map((level) => {
          const firstNode = journey.boards.find(
            (candidate) => candidate.level === level,
          )?.nodes[0];
          const unlocked =
            level === "starter" ||
            (firstNode
              ? isJourneyNodeUnlocked(
                  journey,
                  profile.clearedStopIds,
                  firstNode.id,
                )
              : false);
          return (
            <button
              className={`${styles.boardTab} ${
                viewedLevel === level ? styles.boardTabActive : ""
              }`}
              type="button"
              aria-pressed={viewedLevel === level}
              disabled={!unlocked}
              onClick={() => onViewLevel(level)}
              key={level}
            >
              {levelLabel(level)}
            </button>
          );
        })}
      </nav>

      <section className={styles.boardHeader} aria-labelledby="board-title">
        <p className={styles.kicker}>Journey board · {board.position + 1} of 4</p>
        <h1 id="board-title">{levelLabel(board.level)}</h1>
        <p className={styles.lede}>
          Follow the trail through every game. Two lessons lead to each Turbo
          Time, then one upbeat level challenge brings it all together.
        </p>
        <div className={styles.boardMeta}>
          <span>
            {completedOnBoard} of {board.nodes.length} stops cleared
          </span>
          <span>{board.availableXp} XP available</span>
        </div>
        <div
          className={styles.boardProgress}
          role="progressbar"
          aria-label={`${levelLabel(board.level)} board progress`}
          aria-valuemin={0}
          aria-valuemax={board.nodes.length}
          aria-valuenow={completedOnBoard}
        >
          <span
            style={{
              width: `${(completedOnBoard / board.nodes.length) * 100}%`,
            }}
          />
        </div>
      </section>

      <section className={styles.path} aria-label={`${levelLabel(board.level)} path`}>
        <svg
          className={styles.pathLine}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d="M22 2 C22 7 78 7 78 12 S22 17 22 22 S78 27 78 32 S22 37 22 42 S78 47 78 52 S22 57 22 62 S78 67 78 72 S22 77 22 82 S78 88 50 98" />
        </svg>
        <ol className={styles.nodeList}>
          {board.nodes.map((node, index) => {
            const gameSlug =
              node.kind === "culmination" ? undefined : node.gameSlug;
            const game = gameSlug
              ? games.find((candidate) => candidate.slug === gameSlug)
              : undefined;
            const unlocked = isJourneyNodeUnlocked(
              journey,
              profile.clearedStopIds,
              node.id,
            );
            const isCleared = cleared.has(node.id);
            const isCurrent = nextNode?.id === node.id;
            const isActive = activeAttempt?.stopId === node.id;
            const isTrailPosition = trailNode?.id === node.id;
            const blockedByActiveAttempt = Boolean(activeAttempt && !isActive);
            const buttonState = isCurrent || isActive
                ? styles.nodeCurrent
                : isCleared
                  ? styles.nodeCleared
                : styles.nodeLocked;
            const nodeKindClass =
              node.kind === "turbo"
                ? styles.nodeTurbo
                : node.kind === "culmination"
                  ? styles.nodeCulmination
                  : "";
            const label =
              node.kind === "turbo"
                ? `Turbo Time · ${game?.title ?? "game"}`
                : node.kind === "culmination"
                  ? `${levelLabel(node.level)} level challenge`
                  : (game?.title ?? "Journey game");
            const detail = isActive
              ? "Continue your saved stop"
              : isCleared
                ? "Cleared"
                : isCurrent
                  ? `${node.xp} XP when cleared`
                  : "Locked";
            const ShelfIcon = game?.ShelfIcon;

            return (
              <li
                className={`${styles.nodeItem} ${nodeAlignment(index)}`}
                key={node.id}
                ref={isTrailPosition ? trailItemRef : undefined}
              >
                <div className={styles.nodeWrap}>
                  {isTrailPosition && viewedLevel === currentBoardLevel ? (
                    <span
                      className={`${styles.walker} ${
                        arrivalNodeId === node.id ? styles.walkerArriving : ""
                      }`}
                      style={walkerTravelStyle(index)}
                    >
                      <Avatar
                        avatar={avatarId}
                        size={60}
                        state={
                          arrivalNodeId === node.id ? "walking" : "idle"
                        }
                        label={`${profile.name}'s avatar at the current stop`}
                      />
                    </span>
                  ) : null}
                  <button
                    className={`${styles.nodeButton} ${buttonState} ${nodeKindClass}`}
                    type="button"
                    disabled={
                      !unlocked ||
                      blockedByActiveAttempt ||
                      (isCleared && !isActive)
                    }
                    aria-label={`${label}. ${detail}`}
                    aria-current={isTrailPosition ? "step" : undefined}
                    onClick={() => onLaunch(node)}
                    ref={isTrailPosition ? trailButtonRef : undefined}
                  >
                    {ShelfIcon && node.kind === "normal" ? (
                      <ShelfIcon aria-hidden="true" focusable="false" />
                    ) : (
                      <span className={styles.nodeSymbol} aria-hidden="true">
                        {node.kind === "turbo" ? "⚡" : "★"}
                      </span>
                    )}
                    {isCleared ? (
                      <span className={styles.stateMark} aria-hidden="true">
                        ✓
                      </span>
                    ) : null}
                  </button>
                  <span className={styles.nodeCopy}>
                    <strong>{label}</strong>
                    <span>{detail}</span>
                    {isActive && activeAttempt && !activeAttempt.settlement ? (
                      <button
                        className={styles.restartStopButton}
                        type="button"
                        onClick={() => onRestartActive(activeAttempt.id)}
                      >
                        Restart stop
                      </button>
                    ) : null}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </main>
  );
}

export function JourneyClient() {
  const [state, setState] = useState<ProgressionState | null>(null);
  const [storageWarning, setStorageWarning] = useState(false);
  const [storageIssue, setStorageIssue] = useState<ProgressionLoadStatus | null>(
    null,
  );
  const [profilePanelOpen, setProfilePanelOpen] = useState(false);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [viewedLevel, setViewedLevel] =
    useState<ProgressionLevel>("starter");
  const [arrivalNodeId, setArrivalNodeId] = useState<string | null>(null);

  const profile = state ? activePlayerProfile(state) : undefined;
  const journey = useMemo(
    () => (profile ? buildJourneyPlan(profile.gameSnapshot) : null),
    [profile],
  );
  const nextNode = profile && journey
    ? nextIncompleteJourneyNode(profile, journey)
    : undefined;
  const activeAttempt =
    profile?.activeAttemptId && profile.attempts[profile.activeAttemptId];
  const activeNode =
    journey && activeAttempt
      ? findJourneyNode(journey, activeAttempt.stopId)
      : undefined;
  const trailNode = journey
    ? activeNode ?? nextNode ?? finalJourneyNode(journey)
    : undefined;

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      const loaded = loadProgressionStateDiagnostic();
      setState(loaded.state);
      setStorageIssue(
        loaded.status === "corrupt" ||
          loaded.status === "unsupported" ||
          loaded.status === "unavailable"
          ? loaded.status
          : null,
      );
      if (
        loaded.status === "migrated" &&
        !saveProgressionState(loaded.state)
      ) {
        setStorageWarning(true);
      }
      setSoundEnabled(readSoundPreference());
    }, 0);
    function syncStorage(event: StorageEvent) {
      if (event.key === PROGRESSION_STORAGE_KEY || event.key === null) {
        const loaded = loadProgressionStateDiagnostic();
        setState(loaded.state);
        setStorageIssue(
          loaded.status === "corrupt" ||
            loaded.status === "unsupported" ||
            loaded.status === "unavailable"
            ? loaded.status
            : null,
        );
      }
    }
    window.addEventListener("storage", syncStorage);
    return () => {
      window.clearTimeout(initialTimer);
      window.removeEventListener("storage", syncStorage);
    };
  }, []);

  useEffect(() => {
    if (!trailNode) return;
    const timer = window.setTimeout(() => setViewedLevel(trailNode.level), 0);
    return () => window.clearTimeout(timer);
  }, [trailNode]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!profile || !journey) {
        setArrivalNodeId(null);
        return;
      }
      const arrivedAt = consumeJourneyArrival(profile.id);
      setArrivalNodeId(
        arrivedAt && findJourneyNode(journey, arrivedAt) ? arrivedAt : null,
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [journey, profile]);

  useEffect(() => {
    if (!arrivalNodeId) return;
    const timer = window.setTimeout(() => setArrivalNodeId(null), 950);
    return () => window.clearTimeout(timer);
  }, [arrivalNodeId]);

  function commitState(next: ProgressionState): boolean {
    if (!saveProgressionState(next)) {
      setStorageWarning(true);
      return false;
    }
    setState(next);
    setStorageWarning(false);
    return true;
  }

  function addProfile(name: string, avatarId: AvatarId) {
    const base = state ?? createProgressionState();
    try {
      const next = addPlayerProfile(
        base,
        createPlayerProfile({
          id: profileId(),
          name,
          avatarId,
          gameSnapshot: journeyCatalogSnapshot(),
        }),
      );
      if (commitState(next)) {
        setCreatingProfile(false);
        setProfilePanelOpen(false);
      }
    } catch {
      setStorageWarning(true);
    }
  }

  function launch(node: JourneyNode) {
    if (!state || !profile || !journey) return;
    const canonicalNode = findJourneyNode(journey, node.id);
    if (!canonicalNode) return;
    const existing = profile.activeAttemptId
      ? profile.attempts[profile.activeAttemptId]
      : undefined;
    if (
      profile.clearedStopIds.includes(canonicalNode.id) &&
      existing?.stopId !== canonicalNode.id
    ) {
      return;
    }
    let attempt =
      existing && existing.stopId === canonicalNode.id
        ? existing
        : undefined;
    let nextState = state;

    if (!attempt || attempt.phase === "complete") {
      try {
        attempt = createJourneyAttempt(profile, canonicalNode);
        const nextProfile = upsertProfileAttempt(profile, attempt);
        nextState = replacePlayerProfile(state, nextProfile);
      } catch {
        setStorageWarning(true);
        return;
      }
    }

    if (!saveProgressionState(nextState)) {
      setStorageWarning(true);
      return;
    }
    setState(nextState);
    navigateToProgressionAttempt(attempt);
  }

  function restartActiveStop(attemptId: string) {
    if (!state || !profile || profile.activeAttemptId !== attemptId) return;
    if (
      !window.confirm(
        "Restart this stop from question 1? Completed Journey stops and XP will not change.",
      )
    ) {
      return;
    }
    try {
      commitState(
        replacePlayerProfile(
          state,
          discardActiveProgressionAttempt(profile, attemptId),
        ),
      );
    } catch {
      setStorageWarning(true);
    }
  }

  function toggleSound() {
    const next = !soundEnabled;
    setSoundEnabled(next);
    writeSoundPreference(next);
    if (next) {
      const context = createGameAudioContext();
      if (context?.state === "suspended") {
        void context.resume().catch(() => undefined);
      }
      if (context) {
        window.setTimeout(() => {
          void context.close().catch(() => undefined);
        }, 80);
      }
    }
  }

  function closeProfilePanel() {
    setProfilePanelOpen(false);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>("[data-profile-trigger]")?.focus();
    });
  }

  function retryStorageLoad() {
    const loaded = loadProgressionStateDiagnostic();
    setState(loaded.state);
    setStorageIssue(
      loaded.status === "corrupt" ||
        loaded.status === "unsupported" ||
        loaded.status === "unavailable"
        ? loaded.status
        : null,
    );
  }

  function acceptRecoveredStorage() {
    if (!state || storageIssue !== "corrupt") return;
    if (!saveProgressionState(state)) {
      setStorageWarning(true);
      return;
    }
    setStorageIssue(null);
    setStorageWarning(false);
  }

  function resetStoredJourney() {
    if (
      storageIssue === "unavailable" ||
      !window.confirm(
        "Reset every local Journey player and all Journey progress on this device?",
      )
    ) {
      return;
    }
    if (!removeProgressionState()) {
      setStorageWarning(true);
      return;
    }
    setState(createProgressionState());
    setStorageIssue(null);
    setStorageWarning(false);
  }

  if (state === null) {
    return (
      <div className={styles.page}>
        <JourneyTopbar
          xp={0}
          soundEnabled={soundEnabled}
          onToggleSound={toggleSound}
          onOpenProfiles={() => undefined}
        />
        <main className={styles.loading}>Opening your Journey…</main>
      </div>
    );
  }

  if (storageIssue) {
    const issueCopy =
      storageIssue === "unsupported"
        ? {
            title: "This Journey save is from a newer version.",
            body: "Spatial Gym has left it untouched so this version cannot overwrite newer progress.",
          }
        : storageIssue === "corrupt"
          ? {
              title: "This Journey save needs attention.",
              body: "Spatial Gym found damaged local data and has left the original save untouched.",
            }
          : {
              title: "Journey storage is unavailable.",
              body: "Allow local site storage, then try again. Spatial Gym will not start a player it cannot save.",
            };
    return (
      <div className={styles.page}>
        <JourneyTopbar
          xp={0}
          soundEnabled={soundEnabled}
          onToggleSound={toggleSound}
          onOpenProfiles={() => undefined}
        />
        <main className={styles.onboarding}>
          <section
            className={styles.onboardingCard}
            aria-labelledby="storage-issue-title"
          >
            <p className={styles.kicker}>Local save</p>
            <h1 id="storage-issue-title">{issueCopy.title}</h1>
            <p className={styles.lede}>{issueCopy.body}</p>
            <div
              className={`${styles.formActions} ${styles.storageRecoveryActions}`}
            >
              <button
                className={styles.primaryButton}
                type="button"
                onClick={retryStorageLoad}
              >
                Try again
              </button>
              {storageIssue === "corrupt" && state.profiles.length > 0 ? (
                <button
                  className={styles.secondaryButton}
                  type="button"
                  onClick={acceptRecoveredStorage}
                >
                  Use recovered players
                </button>
              ) : null}
              {storageIssue !== "unavailable" ? (
                <button
                  className={styles.dangerButton}
                  type="button"
                  onClick={resetStoredJourney}
                >
                  Reset local Journey
                </button>
              ) : null}
            </div>
            {storageWarning ? (
              <p className={styles.storageWarning} role="alert">
                Local storage is still unavailable. No Journey data was changed.
              </p>
            ) : null}
          </section>
        </main>
      </div>
    );
  }

  if (!profile || creatingProfile) {
    return (
      <div className={styles.page}>
        <JourneyTopbar
          profile={profile}
          xp={profile ? profileXpTotal(profile) : 0}
          soundEnabled={soundEnabled}
          onToggleSound={toggleSound}
          onOpenProfiles={() => setProfilePanelOpen(true)}
        />
        <ProfileForm
          heading={profile ? "Add another player." : "Who is taking the trail?"}
          submitLabel={profile ? "Add player" : "Start the Journey"}
          onSubmit={addProfile}
          onCancel={profile ? () => setCreatingProfile(false) : undefined}
        />
        {storageWarning ? (
          <p className={styles.storageWarning} role="alert">
            This browser is blocking local saves. Allow site storage before
            starting so progress cannot be lost.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <JourneyTopbar
        profile={profile}
        xp={profileXpTotal(profile)}
        soundEnabled={soundEnabled}
        onToggleSound={toggleSound}
        onOpenProfiles={() => setProfilePanelOpen(true)}
      />
      {storageWarning ? (
        <p className={styles.storageWarning} role="alert">
          Progress could not be saved on this device. Free space or allow site
          storage before continuing.
        </p>
      ) : null}
      <JourneyBoard
        profile={profile}
        viewedLevel={viewedLevel}
        arrivalNodeId={arrivalNodeId}
        onViewLevel={setViewedLevel}
        onLaunch={launch}
        onRestartActive={restartActiveStop}
      />
      {profilePanelOpen ? (
        <ProfilePanel
          key={profile.id}
          state={state}
          profile={profile}
          onChangeState={commitState}
          onClose={closeProfilePanel}
          onCreate={() => {
            setProfilePanelOpen(false);
            setCreatingProfile(true);
          }}
        />
      ) : null}
    </div>
  );
}
