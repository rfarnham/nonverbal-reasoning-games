"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  createBorrowFlashProfileStorage,
  loadBorrowFlashProfilesDiagnostic,
} from "../borrow-flash-profiles";
import {
  buildLatencyDistribution,
  buildRollingPerformanceFrames,
  filterPerformanceAttempts,
  normalizePerformanceAttempts,
  type AnalyticsGameType,
  type LatencyDistribution,
  type NormalizedPerformanceAttempt,
} from "../performance-analytics";
import {
  PERFORMANCE_LEVELS,
  loadPerformanceLogDiagnostic,
  type PerformanceInputMode,
  type PerformanceLevel,
  type PerformanceLoadStatus,
} from "../performance-storage";
import styles from "./performance-analysis.module.css";

type DateRange = "all" | "7" | "30" | "90";
type GameFilter = "all" | Exclude<AnalyticsGameType, "adaptive">;
type PresentationFilter = "all" | "visual" | "listen";
type LevelFilter = "all" | PerformanceLevel;
type InputFilter = "all" | PerformanceInputMode;

type FilterState = Readonly<{
  dateRange: DateRange;
  gameType: GameFilter;
  level: LevelFilter;
  presentation: PresentationFilter;
  input: InputFilter;
  minuend: "all" | `${number}`;
  subtrahend: "all" | `${number}`;
}>;

type LoadState = Readonly<{
  profileId: string;
  profileName: string;
  profileMessage: string | null;
  attempts: readonly NormalizedPerformanceAttempt[];
  coreStatus: PerformanceLoadStatus;
}>;

const DEFAULT_FILTERS: FilterState = {
  dateRange: "all",
  gameType: "all",
  level: "all",
  presentation: "all",
  input: "all",
  minuend: "all",
  subtrahend: "all",
};

const DAY_MS = 24 * 60 * 60 * 1_000;
const MINUENDS = [
  ...Array.from({ length: 8 }, (_, index) => index + 11),
  ...Array.from({ length: 80 }, (_, index) => index + 20),
];
const SUBTRAHENDS = Array.from({ length: 88 }, (_, index) => index + 2);

function ArrowLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14.5 5 7.5 12l7 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 4v10m0 0 4-4m-4 4-4-4M5 18.5h14"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlayIcon({ paused }: Readonly<{ paused: boolean }>) {
  return paused ? (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m9 6 9 6-9 6V6Z" fill="currentColor" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8.5 6.5v11M15.5 6.5v11"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function formatPercent(value: number | null, digits = 0) {
  if (value === null) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: digits,
  }).format(value);
}

function formatSeconds(value: number | null, digits = 1) {
  if (value === null) return "—";
  return `${(value / 1_000).toFixed(digits)} s`;
}

function formatDateTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function formatShortDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp));
}

function gameLabel(gameType: AnalyticsGameType) {
  switch (gameType) {
    case "two-minute":
      return "2 minutes";
    case "deck-sprint":
      return "Deck sprint";
    case "adaptive":
      return "Adaptive";
    default:
      return "Infinite";
  }
}

function storageIssues(load: LoadState): string[] {
  const issues: string[] = [];
  if (load.profileMessage) issues.push(load.profileMessage);
  switch (load.coreStatus) {
    case "corrupt":
      issues.push("Some Flash performance data could not be read. It was left untouched.");
      break;
    case "unsupported":
      issues.push("Flash results were saved by a newer version. They were left untouched.");
      break;
    case "unavailable":
      issues.push("Browser storage is unavailable, so Flash results cannot be read here.");
      break;
    default:
      break;
  }
  return issues;
}

function csvCell(value: string | number | boolean | null) {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function normalizedAttemptsToCsv(
  attempts: readonly NormalizedPerformanceAttempt[],
  profile: Readonly<{ id: string; name: string }>,
) {
  const headers = [
    "profile_id",
    "profile_name",
    "id",
    "source",
    "session_id",
    "date",
    "time",
    "time_zone",
    "utc_offset_minutes",
    "timestamp_ms",
    "occurred_at_iso",
    "game_type",
    "level",
    "presentation_mode",
    "input_mode",
    "orientation",
    "input_source",
    "minuend",
    "subtrahend",
    "expected_answer",
    "submitted_answer",
    "result",
    "correct",
    "outcome_reason",
    "time_taken_ms",
    "time_taken_seconds",
    "timing_eligible",
    "slow_over_4_seconds",
    "is_review",
    "card_id",
    "fact_key",
    "draw_number",
    "deck_cycle",
    "cards_remaining_after",
    "session_position",
    "session_elapsed_ms",
    "review_queued",
    "reinserted",
    "raw_recognition",
    "recognition_confidence",
    "recognition_margin",
    "recognition_processing_ms",
  ];
  const rows = attempts.map((attempt) => [
    profile.id,
    profile.name,
    attempt.id,
    attempt.source,
    attempt.sessionId,
    attempt.localDate,
    attempt.localTime,
    attempt.timeZone,
    attempt.utcOffsetMinutes,
    attempt.timestamp,
    new Date(attempt.timestamp).toISOString(),
    attempt.gameType,
    attempt.level,
    attempt.presentationMode,
    attempt.inputMode,
    attempt.orientation,
    attempt.inputSource,
    attempt.minuend,
    attempt.subtrahend,
    attempt.expectedAnswer,
    attempt.submittedAnswer,
    attempt.correct ? "correct" : "wrong",
    attempt.correct,
    attempt.outcomeReason,
    attempt.latencyMs,
    attempt.latencyMs === null ? null : attempt.latencyMs / 1_000,
    attempt.timingEligible,
    attempt.slow,
    attempt.isReview,
    attempt.cardId,
    attempt.factKey,
    attempt.drawNumber,
    attempt.cycle,
    attempt.cardsRemainingAfter,
    attempt.sessionPosition,
    attempt.sessionElapsedMs,
    attempt.reviewQueued,
    attempt.reinserted,
    attempt.rawRecognition,
    attempt.recognitionConfidence,
    attempt.recognitionMargin,
    attempt.recognitionProcessingMs,
  ]);
  return [headers, ...rows]
    .map((row) => row.map((value) => csvCell(value)).join(","))
    .join("\r\n");
}

function safeFilenamePart(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return normalized || "profile";
}

function DistributionChart({
  overall,
  current,
  windowLabel,
}: Readonly<{
  overall: LatencyDistribution;
  current: LatencyDistribution;
  windowLabel: string;
}>) {
  const titleId = useId();
  const descriptionId = useId();
  const plotLeft = 68;
  const plotTop = 62;
  const plotBottom = 342;
  const plotHeight = plotBottom - plotTop;
  const plotWidth = 898;
  const marks = [...overall.bins, overall.infinity];
  const currentMarks = [...current.bins, current.infinity];
  const step = plotWidth / marks.length;
  const peakShare = Math.max(
    0,
    ...marks.map((mark) => mark.share),
    ...currentMarks.map((mark) => mark.share),
  );
  const yMaximum = Math.min(1, Math.max(0.2, Math.ceil(peakShare * 10) / 10));
  const yForShare = (share: number) =>
    plotBottom - (share / yMaximum) * plotHeight;
  const thresholdX = plotLeft + step * 4;
  const infinityBreakX = plotLeft + step * (marks.length - 1);
  const meanBinIndex = current.correctMeanMs === null
    ? null
    : Math.max(
        0,
        current.bins.findIndex(
          (bin) =>
            current.correctMeanMs !== null &&
            current.correctMeanMs >= bin.minMs &&
            (bin.maxMsExclusive === null ||
              current.correctMeanMs < bin.maxMsExclusive),
        ),
      );
  const meanX = meanBinIndex === null
    ? null
    : plotLeft + step * (meanBinIndex + 0.5);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(
    (fraction) => fraction * yMaximum,
  );

  return (
    <>
      <div className={styles.chartScroller}>
        <svg
          className={styles.chart}
          viewBox="0 0 1000 430"
          role="img"
          aria-labelledby={`${titleId} ${descriptionId}`}
        >
          <title id={titleId}>Response-time distribution</title>
          <desc id={descriptionId}>
            Correct responses are grouped into fixed time bins. Muted bars show
            all filtered attempts and dark bars show {windowLabel}. Wrong
            answers appear in a separate infinity bin.
          </desc>

          {yTicks.map((tick) => {
            const y = yForShare(tick);
            return (
              <g key={tick}>
                <line
                  className={styles.gridLine}
                  x1={plotLeft}
                  x2={plotLeft + plotWidth}
                  y1={y}
                  y2={y}
                />
                <text className={styles.axisText} x={plotLeft - 12} y={y + 4} textAnchor="end">
                  {formatPercent(tick)}
                </text>
              </g>
            );
          })}

          <text
            className={styles.axisTitle}
            x="18"
            y={(plotTop + plotBottom) / 2}
            textAnchor="middle"
            transform={`rotate(-90 18 ${(plotTop + plotBottom) / 2})`}
          >
            Share of attempts
          </text>

          {marks.map((mark, index) => {
            const currentMark = currentMarks[index];
            const xCenter = plotLeft + step * (index + 0.5);
            const overallY = yForShare(mark.share);
            const currentY = yForShare(currentMark.share);
            const wrong = index === marks.length - 1;
            return (
              <g key={mark.id}>
                <rect
                  className={wrong ? styles.wrongOverallBar : styles.overallBar}
                  x={xCenter - 31}
                  y={overallY}
                  width="62"
                  height={Math.max(0, plotBottom - overallY)}
                  rx="6"
                >
                  <title>{`${mark.label}: ${formatPercent(mark.share, 1)} overall`}</title>
                </rect>
                <rect
                  className={wrong ? styles.wrongWindowBar : styles.windowBar}
                  x={xCenter - 20}
                  y={currentY}
                  width="40"
                  height={Math.max(0, plotBottom - currentY)}
                  rx="5"
                >
                  <title>{`${mark.label}: ${formatPercent(currentMark.share, 1)} in this window`}</title>
                </rect>
                {currentMark.share > 0 ? (
                  <text
                    className={wrong ? styles.wrongValue : styles.barValue}
                    x={xCenter}
                    y={Math.max(plotTop - 7, currentY - 9)}
                    textAnchor="middle"
                  >
                    {wrong ? "× " : ""}{formatPercent(currentMark.share)}
                  </text>
                ) : null}
                <text
                  className={wrong ? styles.wrongAxisText : styles.axisText}
                  x={xCenter}
                  y={plotBottom + 27}
                  textAnchor="middle"
                >
                  {wrong ? "Wrong ∞" : mark.label}
                </text>
              </g>
            );
          })}

          <path
            className={styles.infinityBreak}
            d={`M ${infinityBreakX - 8} ${plotBottom + 8} l 6 -12 M ${infinityBreakX + 1} ${plotBottom + 8} l 6 -12`}
          />

          <line
            className={styles.thresholdLine}
            x1={thresholdX}
            x2={thresholdX}
            y1={plotTop - 20}
            y2={plotBottom}
          />
          <text
            className={styles.thresholdText}
            x={thresholdX - 7}
            y={plotTop - 29}
            textAnchor="end"
          >
            4 s slow threshold
          </text>

          {meanX !== null ? (
            <g>
              <line
                className={styles.meanLine}
                x1={meanX}
                x2={meanX}
                y1={plotTop - 4}
                y2={plotBottom}
              />
              <circle className={styles.meanDot} cx={meanX} cy={plotTop - 4} r="5" />
              <text
                className={styles.meanText}
                x={meanX + 8}
                y={plotTop + 12}
              >
                correct mean {formatSeconds(current.correctMeanMs)}
              </text>
            </g>
          ) : null}
        </svg>
      </div>

      <details className={styles.chartDataDetails}>
        <summary>Chart data</summary>
        <div className={styles.tableWrapper}>
          <table className={`${styles.table} ${styles.compactTable}`}>
            <thead>
              <tr>
                <th scope="col">Response</th>
                <th scope="col">All filtered</th>
                <th scope="col">Current window</th>
              </tr>
            </thead>
            <tbody>
              {marks.map((mark, index) => (
                <tr key={mark.id}>
                  <th scope="row">{mark.label}</th>
                  <td>{mark.count} · {formatPercent(mark.share, 1)}</td>
                  <td>
                    {currentMarks[index].count} · {formatPercent(currentMarks[index].share, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

export function PerformanceAnalysisClient() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [load, setLoad] = useState<LoadState | null>(null);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [loadedAt] = useState(() => Date.now());
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exportMessage, setExportMessage] = useState("");

  useEffect(() => {
    const task = window.requestAnimationFrame(() => {
      headingRef.current?.focus();
      try {
        const profiles = loadBorrowFlashProfilesDiagnostic();
        const activeProfile = profiles.registry.profiles.find(
          ({ id }) => id === profiles.registry.activeProfileId,
        );
        if (!activeProfile) {
          throw new Error("The active Borrow Flash profile could not be found.");
        }
        const profileStorage = createBorrowFlashProfileStorage(
          activeProfile.id,
        );
        const core = loadPerformanceLogDiagnostic(profileStorage);
        setLoad({
          profileId: activeProfile.id,
          profileName: activeProfile.name,
          profileMessage: profiles.message,
          attempts: normalizePerformanceAttempts(core.log?.attempts ?? [], []),
          coreStatus: core.status,
        });
      } catch {
        setLoadFailure("Results could not be loaded from this browser.");
      }
    });
    return () => window.cancelAnimationFrame(task);
  }, []);

  const filteredAttempts = useMemo(() => {
    if (!load) return [];
    const dayCount = filters.dateRange === "all" ? null : Number(filters.dateRange);
    const fromTimestamp = dayCount === null ? null : loadedAt - dayCount * DAY_MS;
    const gameTypes = filters.gameType === "all" ? undefined : [filters.gameType];
    const levels = filters.level === "all" ? undefined : [filters.level];
    const presentationModes =
      filters.presentation === "all" ? undefined : [filters.presentation];
    const inputModes =
      filters.input === "all" ? undefined : [filters.input];
    const minuends = filters.minuend === "all" ? undefined : [Number(filters.minuend)];
    const subtrahends = filters.subtrahend === "all"
      ? undefined
      : [Number(filters.subtrahend)];
    const filtered = filterPerformanceAttempts(load.attempts, {
      fromTimestamp,
      gameTypes,
      levels,
      presentationModes,
      inputModes,
      minuends,
      subtrahends,
    });
    return filtered.filter((attempt) => attempt.source !== "adaptive");
  }, [filters, load, loadedAt]);

  const overall = useMemo(
    () => buildLatencyDistribution(filteredAttempts),
    [filteredAttempts],
  );
  const windowAttemptCount = Math.min(
    filteredAttempts.length,
    Math.max(12, Math.min(40, Math.ceil(filteredAttempts.length / 5))),
  );
  const frames = useMemo(
    () => buildRollingPerformanceFrames(filteredAttempts, {
      maxFrames: 20,
      windowAttemptCount: Math.max(1, windowAttemptCount),
    }),
    [filteredAttempts, windowAttemptCount],
  );

  useEffect(() => {
    const task = window.requestAnimationFrame(() => {
      setPlaying(false);
      setFrameIndex(Math.max(0, frames.length - 1));
    });
    return () => window.cancelAnimationFrame(task);
  }, [frames]);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const timer = window.setTimeout(() => {
      if (frameIndex >= frames.length - 1) {
        setPlaying(false);
      } else {
        setFrameIndex(frameIndex + 1);
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [frameIndex, frames.length, playing]);

  const currentFrame = frames[Math.min(frameIndex, frames.length - 1)] ?? null;
  const currentDistribution = currentFrame?.distribution ?? overall;
  const issues = load ? storageIssues(load) : [];
  const hasAnyAttempts = Boolean(load?.attempts.length);
  const windowStartLabel = currentFrame
    ? formatShortDate(currentFrame.windowStartTimestamp)
    : null;
  const windowEndLabel = currentFrame
    ? formatShortDate(currentFrame.windowEndTimestamp)
    : null;
  const windowLabel = windowStartLabel && windowEndLabel
    ? windowStartLabel === windowEndLabel
      ? windowStartLabel
      : `${windowStartLabel}–${windowEndLabel}`
    : "the current window";

  const updateFilter = <Key extends keyof FilterState>(
    key: Key,
    value: FilterState[Key],
  ) => setFilters((current) => ({ ...current, [key]: value }));

  const togglePlayer = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (frameIndex >= frames.length - 1) setFrameIndex(0);
    setPlaying(true);
  };

  const exportCsv = () => {
    if (!load) return;
    const csv = normalizedAttemptsToCsv(filteredAttempts, {
      id: load.profileId,
      name: load.profileName,
    });
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `subtraction-flash-${safeFilenamePart(load.profileName)}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setExportMessage(
      `Downloaded ${filteredAttempts.length} filtered attempts for ${load.profileName}.`,
    );
  };

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link
          className={styles.backLink}
          href="/lab/subtraction-flash/"
          aria-label="Back to Subtraction Flash"
        >
          <ArrowLeftIcon />
        </Link>
        <div className={styles.titleGroup}>
          <h1 ref={headingRef} tabIndex={-1}>Performance</h1>
          <p>{load ? `Profile: ${load.profileName}` : "Saved only in this browser"}</p>
        </div>
        <span aria-hidden="true" />
      </header>

      <main className={styles.main}>
        {loadFailure ? (
          <section className={styles.errorState} role="alert">
            <h2>Results unavailable</h2>
            <p>{loadFailure}</p>
          </section>
        ) : null}

        {issues.length > 0 ? (
          <div className={styles.storageWarnings} role="status">
            {issues.map((issue) => <p key={issue}>{issue}</p>)}
          </div>
        ) : null}

        {!load && !loadFailure ? (
          <p className={styles.loading} role="status">Loading saved results…</p>
        ) : null}

        {load ? (
          <>
            <p className={styles.exportNote} role="status">
              Analyzing <strong>{load.profileName}</strong>. Only this profile’s
              saved Borrow Flash answers are included.
            </p>
            <section className={styles.filters} aria-labelledby="filter-heading">
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.kicker}>Slice the history</p>
                  <h2 id="filter-heading">Filters</h2>
                </div>
                <button
                  className={styles.resetButton}
                  type="button"
                  onClick={() => setFilters(DEFAULT_FILTERS)}
                  disabled={filters === DEFAULT_FILTERS}
                >
                  Reset
                </button>
              </div>
              <div className={styles.filterGrid}>
                <label>
                  <span>Date</span>
                  <select
                    value={filters.dateRange}
                    onChange={(event) => updateFilter("dateRange", event.target.value as DateRange)}
                  >
                    <option value="all">All time</option>
                    <option value="7">Last 7 days</option>
                    <option value="30">Last 30 days</option>
                    <option value="90">Last 90 days</option>
                  </select>
                </label>
                <label>
                  <span>Game</span>
                  <select
                    value={filters.gameType}
                    onChange={(event) => updateFilter("gameType", event.target.value as GameFilter)}
                  >
                    <option value="all">All games</option>
                    <option value="infinite">Infinite</option>
                    <option value="two-minute">2 minutes</option>
                    <option value="deck-sprint">Deck sprint</option>
                  </select>
                </label>
                <label>
                  <span>Level</span>
                  <select
                    value={filters.level}
                    onChange={(event) => updateFilter("level", event.target.value as LevelFilter)}
                  >
                    <option value="all">All levels</option>
                    {PERFORMANCE_LEVELS.map((level) => (
                      <option key={level} value={level}>{level}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Prompt</span>
                  <select
                    value={filters.presentation}
                    onChange={(event) => updateFilter("presentation", event.target.value as PresentationFilter)}
                  >
                    <option value="all">All prompts</option>
                    <option value="visual">Cards</option>
                    <option value="listen">Listen</option>
                  </select>
                </label>
                <label>
                  <span>Input</span>
                  <select
                    value={filters.input}
                    onChange={(event) => updateFilter("input", event.target.value as InputFilter)}
                  >
                    <option value="all">All inputs</option>
                    <option value="tap">Tap</option>
                    <option value="draw">Draw</option>
                    <option value="trace">Trace</option>
                    <option value="speak">Speak</option>
                  </select>
                </label>
                <label>
                  <span>Minuend</span>
                  <select
                    value={filters.minuend}
                    onChange={(event) => updateFilter("minuend", event.target.value as FilterState["minuend"])}
                  >
                    <option value="all">All</option>
                    {MINUENDS.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label>
                  <span>Subtrahend</span>
                  <select
                    value={filters.subtrahend}
                    onChange={(event) => updateFilter("subtrahend", event.target.value as FilterState["subtrahend"])}
                  >
                    <option value="all">All</option>
                    {SUBTRAHENDS.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
              </div>
            </section>
            <p className={styles.visuallyHidden} role="status" aria-live="polite">
              {filteredAttempts.length} attempts match the current filters.
            </p>

            {filteredAttempts.length > 0 ? (
              <>
                <section className={styles.summaryGrid} aria-label="Filtered performance summary">
                  <div className={styles.stat}>
                    <span>Attempts</span>
                    <strong>{overall.totalCount}</strong>
                  </div>
                  <div className={styles.stat}>
                    <span>Accuracy</span>
                    <strong>{formatPercent(overall.accuracy)}</strong>
                  </div>
                  <div className={styles.stat}>
                    <span>Median correct</span>
                    <strong>{formatSeconds(overall.correctMedianMs)}</strong>
                  </div>
                  <div className={`${styles.stat} ${styles.wrongStat}`}>
                    <span>Wrong</span>
                    <strong>× {overall.wrongCount}</strong>
                  </div>
                </section>

                <section className={styles.chartPanel} aria-labelledby="distribution-heading">
                  <div className={styles.chartHeading}>
                    <div>
                      <p className={styles.kicker}>Speed + accuracy</p>
                      <h2 id="distribution-heading">Response distribution</h2>
                      <p>
                        Correct times use fixed bins. Wrong answers form the ∞ spike.
                      </p>
                    </div>
                    <div className={styles.legend} aria-label="Chart legend">
                      <span><i className={styles.overallSwatch} />All filtered</span>
                      <span><i className={styles.windowSwatch} />Current window</span>
                      <span><i className={styles.wrongSwatch} />Wrong ∞</span>
                    </div>
                  </div>

                  <DistributionChart
                    overall={overall}
                    current={currentDistribution}
                    windowLabel={windowLabel}
                  />

                  <div className={styles.player}>
                    <button
                      className={styles.playButton}
                      type="button"
                      onClick={togglePlayer}
                      disabled={frames.length < 2}
                      aria-label={playing ? "Pause history" : "Play history"}
                    >
                      <PlayIcon paused={!playing} />
                      {playing ? "Pause" : "Play"}
                    </button>
                    <label className={styles.scrubberLabel}>
                      <span>
                        <strong>History window</strong>
                        <output>
                          {currentFrame
                            ? `${frameIndex + 1} of ${frames.length} · ${windowLabel} · ${currentFrame.attemptCount} attempts`
                            : "No window"}
                        </output>
                      </span>
                      <input
                        type="range"
                        min="0"
                        max={Math.max(0, frames.length - 1)}
                        step="1"
                        value={Math.min(frameIndex, Math.max(0, frames.length - 1))}
                        onChange={(event) => {
                          setPlaying(false);
                          setFrameIndex(Number(event.target.value));
                        }}
                        disabled={frames.length < 2}
                        aria-valuetext={currentFrame
                          ? `Window ${frameIndex + 1} of ${frames.length}, ${windowLabel}`
                          : "No history window"}
                      />
                    </label>
                  </div>
                </section>

                <section className={styles.dataSection} aria-labelledby="raw-heading">
                  <div className={styles.dataHeading}>
                    <div>
                      <p className={styles.kicker}>Every answer</p>
                      <h2 id="raw-heading">Raw attempts</h2>
                    </div>
                    <button className={styles.downloadButton} type="button" onClick={exportCsv}>
                      <DownloadIcon />
                      Download CSV
                    </button>
                  </div>
                  <p className={styles.exportNote} aria-live="polite">
                    {exportMessage || `The download includes only ${load.profileName}’s filtered attempts and detailed performance fields.`}
                  </p>
                  <details className={styles.rawDetails}>
                    <summary>View raw rows</summary>
                    <p>
                      Showing the latest {Math.min(100, filteredAttempts.length)} of {filteredAttempts.length} filtered rows.
                    </p>
                    <div className={styles.tableWrapper}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th scope="col">Date &amp; time</th>
                            <th scope="col">Game</th>
                            <th scope="col">Level</th>
                            <th scope="col">Problem</th>
                            <th scope="col">Answer</th>
                            <th scope="col">Result</th>
                            <th scope="col">Time</th>
                            <th scope="col">Prompt</th>
                            <th scope="col">Input</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...filteredAttempts].reverse().slice(0, 100).map((attempt) => (
                            <tr key={attempt.id}>
                              <td>{formatDateTime(attempt.timestamp)}</td>
                              <td>{gameLabel(attempt.gameType)}</td>
                              <td>{attempt.level ?? "—"}</td>
                              <td>
                                {attempt.minuend === null || attempt.subtrahend === null
                                  ? "—"
                                  : `${attempt.minuend} − ${attempt.subtrahend}`}
                              </td>
                              <td>{attempt.submittedAnswer ?? "—"}</td>
                              <td className={attempt.correct ? styles.correctCell : styles.wrongCell}>
                                {attempt.correct ? "✓ Correct" : "× Wrong"}
                              </td>
                              <td>{formatSeconds(attempt.latencyMs, 2)}</td>
                              <td>{attempt.presentationMode === "listen" ? "Listen" : "Cards"}</td>
                              <td>
                                {attempt.inputMode ?? "—"}
                                {attempt.inputMode && attempt.inputSource !== attempt.inputMode
                                  ? ` · ${attempt.inputSource}`
                                  : ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </section>
              </>
            ) : (
              <section className={styles.emptyState}>
                <h2>{hasAnyAttempts ? "No matching attempts" : "No saved attempts yet"}</h2>
                <p>
                  {hasAnyAttempts
                    ? "Change or reset the filters to bring results back into view."
                    : "Play Subtraction Flash and each answer will appear here on this device."}
                </p>
                {hasAnyAttempts ? (
                  <button type="button" onClick={() => setFilters(DEFAULT_FILTERS)}>Reset filters</button>
                ) : (
                  <Link href="/lab/subtraction-flash/">Play Subtraction Flash</Link>
                )}
              </section>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
