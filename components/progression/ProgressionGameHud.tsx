import Link from "next/link";

import styles from "./progression-game-hud.module.css";

type ProgressionGameHudProps = {
  mode: "normal" | "review" | "turbo" | "culmination";
  levelLabel: string;
  current: number;
  total: number | null;
  remainingMs?: number;
  paused?: boolean;
  redemption?: boolean;
};

function formatRemainingTime(remainingMs: number) {
  const clampedSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(clampedSeconds / 60);
  const seconds = clampedSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function modeLabel(
  mode: ProgressionGameHudProps["mode"],
  redemption: boolean,
) {
  if (mode === "turbo") {
    return redemption ? "Turbo Time · Redemption" : "Turbo Time";
  }
  if (mode === "review") {
    return redemption ? "Spatial review · Redemption" : "Spatial review";
  }
  if (mode === "culmination") return "Level challenge";
  return "Journey stop";
}

export function ProgressionGameHud({
  mode,
  levelLabel,
  current,
  total,
  remainingMs,
  paused = false,
  redemption = false,
}: Readonly<ProgressionGameHudProps>) {
  const progressMax = Math.max(total ?? current, 1);
  const progressValue = Math.max(1, Math.min(current, progressMax));

  return (
    <aside
      className={styles.hud}
      aria-label={`${modeLabel(mode, redemption)} progress`}
    >
      <div className={styles.identity}>
        <span className={styles.mode}>{modeLabel(mode, redemption)}</span>
        <strong>{levelLabel}</strong>
      </div>

      {mode === "turbo" && !redemption && remainingMs !== undefined ? (
        <div className={styles.timer}>
          <span>{paused ? "Paused" : "Active time"}</span>
          <strong
            role="timer"
            aria-label={`${formatRemainingTime(remainingMs)} remaining${
              paused ? ", paused" : ""
            }`}
          >
            {formatRemainingTime(remainingMs)}
          </strong>
        </div>
      ) : (
        <div
          className={styles.progress}
          role="progressbar"
          aria-label="Current question"
          aria-valuemin={1}
          aria-valuemax={progressMax}
          aria-valuenow={progressValue}
        >
          <span>
            Question {progressValue}
            {total === null ? "" : ` of ${total}`}
          </span>
          <span className={styles.track} aria-hidden="true">
            <span
              className={styles.fill}
              style={{
                width:
                  total === null
                    ? "100%"
                    : `${(progressValue / progressMax) * 100}%`,
              }}
            />
          </span>
        </div>
      )}

      <Link className={styles.back} href="/journey/">
        Journey map
      </Link>
    </aside>
  );
}
