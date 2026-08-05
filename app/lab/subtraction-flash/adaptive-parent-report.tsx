import { useMemo } from "react";

import type { AdaptiveSubtractionProgress } from "./adaptive-storage";
import { buildParentProgressSummary } from "./adaptive/analytics";
import { benchmarkEligibility } from "./adaptive/scheduling";
import { skillDefinition } from "./adaptive/skills";
import type { AdaptiveSettings } from "./adaptive/types";
import styles from "./adaptive-curriculum.module.css";

type Props = Readonly<{
  progress: AdaptiveSubtractionProgress;
  sessionActive: boolean;
  onStartBenchmark(): void;
  onSettingsChange(changes: Partial<AdaptiveSettings>): void;
}>;

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function duration(value: number | null): string {
  if (value === null) return "—";
  const seconds = value / 1_000;
  return seconds < 10 ? `${seconds.toFixed(1)} s` : `${Math.round(seconds)} s`;
}

function statusLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function responseTrend(value: number | null): string {
  if (value === null) return "—";
  if (Math.abs(value) < 0.03) return "Steady";
  return value > 0
    ? `${Math.round(value * 100)}% quicker`
    : `${Math.round(Math.abs(value) * 100)}% slower`;
}

function lateSessionChange(value: number | null): string {
  if (value === null) return "—";
  const change = value - 1;
  if (Math.abs(change) < 0.05) return "Steady";
  return change > 0
    ? `${Math.round(change * 100)}% slower`
    : `${Math.round(Math.abs(change) * 100)}% quicker`;
}

function targetComparison(value: number | null, target: number | null): string {
  if (value === null || target === null) return "No target set";
  const tolerance = Math.max(1_000, target * 0.02);
  if (Math.abs(value) <= tolerance) return "Within target";
  return value < 0
    ? `${duration(Math.abs(value))} under target`
    : `${duration(value)} over target`;
}

export function AdaptiveParentReport({
  progress,
  sessionActive,
  onStartBenchmark,
  onSettingsChange,
}: Props) {
  const report = useMemo(
    () =>
      buildParentProgressSummary({
        learnerId: progress.learnerId,
        attempts: progress.attemptEvents,
        skillStates: progress.skillStates,
        recognitionEvents: progress.recognitionEvents,
        reviewSchedule: progress.reviewSchedule,
        completedSessions: progress.completedSessions,
        parentBenchmarkTargetMs: progress.settings.parentBenchmarkTargetMs,
      }),
    [progress],
  );
  const benchmark = benchmarkEligibility(
    progress.completedSessions,
    progress.attemptEvents,
  );
  const errorEntries = Object.entries(report.errorPatternCounts)
    .filter((entry): entry is [string, number] => (entry[1] ?? 0) > 0)
    .sort((left, right) => right[1] - left[1]);

  return (
    <details className={styles.parentPanel}>
      <summary>Parent details</summary>
      <div className={styles.parentContent}>
        <div className={styles.parentIntro}>
          <div>
            <span className={styles.parentKicker}>Private progress</span>
            <h3>Accuracy and timing stay separate</h3>
            <p>
              These timings help distinguish thinking from handwriting. They
              never block new content or appear in the child session.
            </p>
          </div>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={!benchmark.eligible || sessionActive}
            onClick={onStartBenchmark}
          >
            {benchmark.eligible ? "Start weekly check" : "Weekly check complete"}
          </button>
        </div>

        <div className={styles.parentMetrics}>
          <div className={styles.metric}>
            <span>First-attempt accuracy</span>
            <strong>{percent(report.accuracy.firstAttemptAccuracy)}</strong>
          </div>
          <div className={styles.metric}>
            <span>Independent / assisted</span>
            <strong>
              {report.accuracy.independentAttemptCount} /{" "}
              {report.accuracy.assistedAttemptCount}
            </strong>
          </div>
          <div className={styles.metric}>
            <span>Hint rate</span>
            <strong>{percent(report.accuracy.hintRate)}</strong>
          </div>
          <div className={styles.metric}>
            <span>Median response</span>
            <strong>{duration(report.speed.medianResponseMs)}</strong>
          </div>
          <div className={styles.metric}>
            <span>Response-time trend</span>
            <strong>{responseTrend(report.speed.responseTimeTrendRatio)}</strong>
          </div>
          <div className={styles.metric}>
            <span>Median time to first ink</span>
            <strong>{duration(report.speed.medianFirstInkLatencyMs)}</strong>
          </div>
          <div className={styles.metric}>
            <span>Median writing time</span>
            <strong>{duration(report.speed.medianWritingDurationMs)}</strong>
          </div>
          <div className={styles.metric}>
            <span>Correction rate</span>
            <strong>{percent(report.accuracy.correctionRate)}</strong>
          </div>
          <div className={styles.metric}>
            <span>Spaced-review retention</span>
            <strong>{percent(report.retention.reviewAccuracy)}</strong>
          </div>
          <div className={styles.metric}>
            <span>Late-session change</span>
            <strong>
              {lateSessionChange(report.fatigue.lateSessionSlowdownRatio)}
            </strong>
          </div>
          <div className={styles.metric}>
            <span>Recognition checks</span>
            <strong>
              {report.recognition.confirmedCount +
                report.recognition.correctedCount}
            </strong>
          </div>
        </div>

        <div>
          <h4>Latest weekly check</h4>
          {report.benchmark.latestCompletedAt === null ? (
            <p className={styles.parentNote}>
              Benchmark details will appear after the first weekly check.
            </p>
          ) : (
            <>
              <div className={styles.parentMetrics}>
                <div className={styles.metric}>
                  <span>Cards recorded</span>
                  <strong>{report.benchmark.attemptedProblemCount}</strong>
                </div>
                <div className={styles.metric}>
                  <span>First-attempt accuracy</span>
                  <strong>{percent(report.benchmark.firstAttemptAccuracy)}</strong>
                </div>
                <div className={styles.metric}>
                  <span>Total active time</span>
                  <strong>{duration(report.benchmark.activeDurationMs)}</strong>
                </div>
                <div className={styles.metric}>
                  <span>Median response</span>
                  <strong>{duration(report.benchmark.medianResponseMs)}</strong>
                </div>
                <div className={styles.metric}>
                  <span>Median time to first ink</span>
                  <strong>
                    {duration(report.benchmark.medianFirstInkLatencyMs)}
                  </strong>
                </div>
                <div className={styles.metric}>
                  <span>Median writing time</span>
                  <strong>
                    {duration(report.benchmark.medianWritingDurationMs)}
                  </strong>
                </div>
                <div className={styles.metric}>
                  <span>Late-set change</span>
                  <strong>
                    {lateSessionChange(report.benchmark.lateSetSlowdownRatio)}
                  </strong>
                </div>
                <div className={styles.metric}>
                  <span>External target comparison</span>
                  <strong>
                    {targetComparison(
                      report.benchmark.activeDurationVsTargetMs,
                      report.benchmark.targetMs,
                    )}
                  </strong>
                </div>
              </div>
              {Object.keys(report.benchmark.errorPatternCounts).length ? (
                <p className={styles.parentNote}>
                  Check errors: {Object.entries(
                    report.benchmark.errorPatternCounts,
                  )
                    .map(([code, count]) => `${statusLabel(code)}: ${count}`)
                    .join(" · ")}
                </p>
              ) : null}
            </>
          )}
        </div>

        <div>
          <h4>Skills</h4>
          <div className={styles.skillGrid}>
            {report.skills.length ? (
              report.skills.map((skill) => (
                <div className={styles.skillRow} key={skill.skillId}>
                  <strong>{skillDefinition(skill.skillId).title}</strong>
                  <span>
                    Concept: {statusLabel(skill.conceptStatus)} · Fluency:{" "}
                    {statusLabel(skill.fluencyStatus)}
                  </span>
                  <span>
                    {skill.independentAttemptCount} independent ·{" "}
                    {skill.assistedAttemptCount} assisted
                  </span>
                </div>
              ))
            ) : (
              <p className={styles.parentNote}>
                Skill evidence will appear after the first short session.
              </p>
            )}
          </div>
        </div>

        {errorEntries.length ? (
          <div>
            <h4>Error patterns</h4>
            <ul className={styles.errorList}>
              {errorEntries.map(([code, count]) => (
                <li key={code}>
                  {statusLabel(code)}: {count}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {report.notes.length ? (
          <ul className={styles.errorList}>
            {report.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}

        <label className={styles.parentNote}>
          Optional external benchmark target (seconds; parent reference only)
          <input
            className={styles.numericInput}
            type="number"
            min="1"
            step="1"
            value={
              progress.settings.parentBenchmarkTargetMs === null
                ? ""
                : Math.round(progress.settings.parentBenchmarkTargetMs / 1_000)
            }
            placeholder="Not set"
            onChange={(event) => {
              const seconds = Number(event.currentTarget.value);
              onSettingsChange({
                parentBenchmarkTargetMs:
                  Number.isFinite(seconds) && seconds > 0
                    ? Math.round(seconds * 1_000)
                    : null,
              });
            }}
          />
        </label>
      </div>
    </details>
  );
}
