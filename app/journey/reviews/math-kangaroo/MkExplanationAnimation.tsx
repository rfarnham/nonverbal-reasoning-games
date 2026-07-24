import {
  useId,
  type CSSProperties,
  type ReactNode,
} from "react";

import type {
  MkAnimationBeat,
  MkChoice,
  MkGroundedVisualBeat,
  MkIllustration,
  MkVisualExplanation,
  MkVisualRegion,
} from "./engine";

import styles from "./math-kangaroo.module.css";

const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
const VIEWBOX_SIZE = 1_000;

type ExplanationViewBox = Readonly<{
  width: number;
  height: number;
}>;

type Props = Readonly<{
  illustration: MkIllustration;
  choices: readonly [MkChoice, MkChoice, MkChoice, MkChoice, MkChoice];
  visual?: MkVisualExplanation;
  fallbackBeats?: readonly MkAnimationBeat[];
}>;

type GroundedStyle = CSSProperties & Readonly<{
  "--mk-delay": string;
  "--mk-final-transform"?: string;
  "--mk-transform-origin"?: string;
}>;

function beatSymbol(kind: string): string {
  if (kind === "transform") return "↻";
  if (kind === "trace") return "→";
  if (kind === "compare") return "⇄";
  if (kind === "count") return "123";
  if (kind === "reveal") return "✓";
  if (kind === "spotlight") return "◎";
  const normalized = kind.toLowerCase();
  if (normalized.includes("reflect") || normalized.includes("mirror")) {
    return "↔";
  }
  if (normalized.includes("rotate") || normalized.includes("turn")) {
    return "↻";
  }
  if (normalized.includes("trace") || normalized.includes("follow")) {
    return "→";
  }
  if (normalized.includes("count")) return "123";
  return "◎";
}

function scaledX(value: number, viewBox: ExplanationViewBox): number {
  return value * viewBox.width;
}

function scaledY(value: number, viewBox: ExplanationViewBox): number {
  return value * viewBox.height;
}

function regionCenter(
  region: MkVisualRegion,
  viewBox: ExplanationViewBox,
): Readonly<{
  x: number;
  y: number;
}> {
  return {
    x: scaledX(region.x + region.width / 2, viewBox),
    y: scaledY(region.y + region.height / 2, viewBox),
  };
}

function overlayStyle(
  index: number,
  extras: Partial<GroundedStyle> = {},
): GroundedStyle {
  return {
    "--mk-delay": `${index * 720}ms`,
    ...extras,
  };
}

function regionOutline(
  region: MkVisualRegion,
  className: string,
  viewBox: ExplanationViewBox,
): ReactNode {
  return (
    <rect
      className={className}
      x={scaledX(region.x, viewBox)}
      y={scaledY(region.y, viewBox)}
      width={scaledX(region.width, viewBox)}
      height={scaledY(region.height, viewBox)}
      rx="12"
    />
  );
}

function transformValue(
  beat: Extract<MkGroundedVisualBeat, { kind: "transform" }>,
  viewBox: ExplanationViewBox,
): string {
  const translateX = scaledX(beat.translation?.x ?? 0, viewBox);
  const translateY = scaledY(beat.translation?.y ?? 0, viewBox);
  const rotate = beat.rotateDeg ?? 0;
  const scaleX =
    beat.reflection === "across-vertical-axis" ? -1 : 1;
  const scaleY =
    beat.reflection === "across-horizontal-axis" ? -1 : 1;
  return [
    `translate(${translateX}px, ${translateY}px)`,
    `rotate(${rotate}deg)`,
    `scale(${scaleX}, ${scaleY})`,
  ].join(" ");
}

function GroundedBeatOverlay({
  beat,
  index,
  regions,
  visual,
  imageSrc,
  idPrefix,
  viewBox,
}: Readonly<{
  beat: MkGroundedVisualBeat;
  index: number;
  regions: ReadonlyMap<string, MkVisualRegion>;
  visual: MkVisualExplanation;
  imageSrc: string;
  idPrefix: string;
  viewBox: ExplanationViewBox;
}>) {
  const final = index === visual.beats.length - 1;
  const finalClass = final ? styles.groundedBeatFinal : "";

  if (beat.kind === "trace") {
    const path = visual.paths.find(({ id }) => id === beat.target);
    if (!path) return null;
    const points = path.points
      .map(
        ({ x, y }) =>
          `${scaledX(x, viewBox)},${scaledY(y, viewBox)}`,
      )
      .join(" ");
    const PathElement = path.closed ? "polygon" : "polyline";
    return (
      <PathElement
        className={`${styles.groundedBeat} ${styles.groundedTrace} ${finalClass}`}
        points={points}
        pathLength="1"
        style={overlayStyle(index)}
      />
    );
  }

  if (beat.kind === "compare") {
    const first = regions.get(beat.targets[0]);
    const second = regions.get(beat.targets[1]);
    if (!first || !second) return null;
    const from = regionCenter(first, viewBox);
    const to = regionCenter(second, viewBox);
    return (
      <g
        className={`${styles.groundedBeat} ${styles.groundedCompare} ${finalClass}`}
        style={overlayStyle(index)}
      >
        {regionOutline(first, styles.groundedCompareRegion, viewBox)}
        {regionOutline(second, styles.groundedCompareRegion, viewBox)}
        <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
      </g>
    );
  }

  if (beat.kind === "count") {
    return (
      <g
        className={`${styles.groundedBeat} ${styles.groundedCount} ${finalClass}`}
        style={overlayStyle(index)}
      >
        {beat.targets.map((target, targetIndex) => {
          const region = regions.get(target);
          if (!region) return null;
          const center = regionCenter(region, viewBox);
          return (
            <g key={target}>
              {regionOutline(
                region,
                styles.groundedCountRegion,
                viewBox,
              )}
              <circle cx={center.x} cy={center.y} r="25" />
              <text x={center.x} y={center.y}>
                {targetIndex + 1}
              </text>
            </g>
          );
        })}
      </g>
    );
  }

  const target = beat.target;
  if (target === undefined) {
    return null;
  }

  const region = regions.get(target);
  if (!region) return null;

  if (beat.kind === "transform") {
    const center = regionCenter(region, viewBox);
    const clipId = `${idPrefix}-transform-${index}`;
    return (
      <g>
        <defs>
          <clipPath id={clipId}>
            <rect
              x={scaledX(region.x, viewBox)}
              y={scaledY(region.y, viewBox)}
              width={scaledX(region.width, viewBox)}
              height={scaledY(region.height, viewBox)}
            />
          </clipPath>
        </defs>
        {regionOutline(
          region,
          styles.groundedTransformSource,
          viewBox,
        )}
        <g
          className={`${styles.groundedBeat} ${styles.groundedTransform} ${finalClass}`}
          style={overlayStyle(index, {
            "--mk-final-transform": transformValue(beat, viewBox),
            "--mk-transform-origin": `${center.x}px ${center.y}px`,
          })}
        >
          <image
            href={imageSrc}
            x="0"
            y="0"
            width={viewBox.width}
            height={viewBox.height}
            preserveAspectRatio="none"
            clipPath={`url(#${clipId})`}
          />
          {regionOutline(
            region,
            styles.groundedTransformRegion,
            viewBox,
          )}
        </g>
      </g>
    );
  }

  if (beat.kind === "reveal") {
    const center = regionCenter(region, viewBox);
    const halfWidth = scaledX(region.width, viewBox) / 2;
    const halfHeight = scaledY(region.height, viewBox) / 2;
    return (
      <g
        className={`${styles.groundedBeat} ${styles.groundedReveal} ${finalClass}`}
        style={overlayStyle(index)}
      >
        {regionOutline(region, styles.groundedRevealRegion, viewBox)}
        <circle
          cx={center.x + halfWidth - 27}
          cy={center.y - halfHeight + 27}
          r="24"
        />
        <text
          x={center.x + halfWidth - 27}
          y={center.y - halfHeight + 27}
        >
          ✓
        </text>
      </g>
    );
  }

  return (
    <g
      className={`${styles.groundedBeat} ${styles.groundedSpotlight} ${finalClass}`}
      style={overlayStyle(index)}
    >
      {regionOutline(region, styles.groundedSpotlightRegion, viewBox)}
    </g>
  );
}

export function MkExplanationAnimation({
  illustration,
  choices,
  visual,
  fallbackBeats = [],
}: Props) {
  const reactId = useId();
  const idPrefix = `mk-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const imageSrc = `${basePath}${illustration.src}`;
  const regions = new Map(
    visual?.regions.map((region) => [region.id, region]) ?? [],
  );
  const narratedBeats = visual?.beats.map((beat) => ({
    symbol: beat.kind,
    narration: beat.narration,
  })) ?? fallbackBeats.map((beat) => ({
    symbol: beat.action,
    narration: beat.narration,
  }));
  const finalBeat = visual?.beats.at(-1);
  const semanticChoiceIndex =
    finalBeat?.kind === "reveal" && finalBeat.choiceIndex !== undefined
      ? finalBeat.choiceIndex
      : null;
  const semanticChoice =
    semanticChoiceIndex === null ? null : choices[semanticChoiceIndex];
  const illustrationAspect = illustration.width / illustration.height;
  const viewBox: ExplanationViewBox = {
    width: VIEWBOX_SIZE * illustrationAspect,
    height: VIEWBOX_SIZE,
  };
  const illustrationIsWide = illustrationAspect > 3.5;
  const illustrationWidth = Math.min(illustration.width, 900);
  const illustrationMinWidth = illustrationIsWide
    ? Math.min(
        illustration.width,
        Math.max(640, illustrationAspect * 120),
      )
    : undefined;

  return (
    <figure className={styles.explanationSequence}>
      <div
        className={[
          styles.explanationAnimation,
          illustrationIsWide
            ? styles.explanationAnimationScrollable
            : "",
        ].filter(Boolean).join(" ")}
        role={illustrationIsWide ? "region" : undefined}
        tabIndex={illustrationIsWide ? 0 : undefined}
        aria-label={
          illustrationIsWide
            ? "Scrollable visual explanation"
            : undefined
        }
      >
        <svg
          viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
          preserveAspectRatio="xMidYMid meet"
          style={{
            aspectRatio: `${illustration.width} / ${illustration.height}`,
            maxWidth: `${illustrationWidth}px`,
            ...(illustrationMinWidth === undefined
              ? {}
              : { minWidth: `${illustrationMinWidth}px` }),
          }}
          role="img"
          aria-label={
            visual
              ? "The original question illustration with solution marks placed on the exact features being explained."
              : illustration.alt
          }
        >
          <image
            href={imageSrc}
            x="0"
            y="0"
            width={viewBox.width}
            height={viewBox.height}
            preserveAspectRatio="none"
          />
          {visual?.beats.map((beat, index) => (
            <GroundedBeatOverlay
              beat={beat}
              index={index}
              regions={regions}
              visual={visual}
              imageSrc={imageSrc}
              idPrefix={idPrefix}
              viewBox={viewBox}
              key={`${beat.kind}-${index}`}
            />
          ))}
        </svg>
      </div>
      {illustrationIsWide ? (
        <p className={styles.scrollHint}>
          Scroll sideways to inspect the full visual explanation.
        </p>
      ) : null}
      {!visual ? (
        <p className={styles.explanationFallback}>
          Follow the verified steps on the original puzzle illustration.
        </p>
      ) : null}
      {semanticChoice?.displayText !== undefined ? (
        <div
          className={styles.semanticReveal}
          style={{
            "--mk-delay": `${Math.max((visual?.beats.length ?? 1) - 1, 0) * 720}ms`,
          } as GroundedStyle}
          role="status"
          aria-label={`Verified answer ${semanticChoiceIndex! + 1}: ${semanticChoice.accessibleLabel}`}
        >
          <span className={styles.semanticRevealIndex} aria-hidden="true">
            {semanticChoiceIndex! + 1}
          </span>
          <span>{semanticChoice.displayText}</span>
          <span className={styles.semanticRevealMark} aria-hidden="true">
            ✓
          </span>
        </div>
      ) : null}
      {narratedBeats.length ? (
        <ol className={styles.animationBeats} aria-label="Visual solution">
          {narratedBeats.map((beat, index) => (
            <li
              style={{ animationDelay: `${Math.min(index, 6) * 180}ms` }}
              key={`${beat.symbol}-${index}`}
            >
              <span className={styles.animationBeatSymbol} aria-hidden="true">
                {beatSymbol(beat.symbol)}
              </span>
              <span>{beat.narration}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </figure>
  );
}
