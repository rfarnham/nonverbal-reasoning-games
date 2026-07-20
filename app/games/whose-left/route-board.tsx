import type { CSSProperties } from "react";

import {
  landmarkLinksForRound,
  namesForSequence,
  routeCrossings,
  type AnswerSequence,
  type Person,
  type Point,
  type Round,
  type RouteCrossing,
} from "./game-engine";
import styles from "./whose-left.module.css";

type CustomProperties = CSSProperties & Record<`--${string}`, string>;

const PERSON_COLOR_CLASSES = [
  styles.personCoral,
  styles.personGold,
  styles.personTeal,
  styles.personViolet,
] as const;

function personColorClass(person: Person): string {
  return PERSON_COLOR_CLASSES[person.segmentIndex % PERSON_COLOR_CLASSES.length];
}

function personForId(round: Pick<Round, "people">, id: string): Person {
  return (
    round.people.find((person) => person.id === id) ?? {
      id,
      name: id,
      initial: "?",
      segmentIndex: 0,
      position: { x: 0, y: 0 },
      side: "left",
    }
  );
}

function routePoints(round: Round): string {
  return round.route.points.map(({ x, y }) => `${x},${y}`).join(" ");
}

function segmentAngle(round: Round, segmentIndex: number): number {
  const segment = round.route.segments[segmentIndex];
  if (!segment) return 0;
  return (
    (Math.atan2(
      segment.to.y - segment.from.y,
      segment.to.x - segment.from.x,
    ) *
      180) /
    Math.PI
  );
}

function segmentPosition(
  round: Round,
  segmentIndex: number,
  progress = 0.58,
) {
  const segment = round.route.segments[segmentIndex];
  if (!segment) return { x: 0, y: 0 };
  return {
    x: segment.from.x + (segment.to.x - segment.from.x) * progress,
    y: segment.from.y + (segment.to.y - segment.from.y) * progress,
  };
}

function visitBadgePosition(
  round: Round,
  person: Person,
  anchor: Point,
  markerPosition: Point,
): Point {
  const segment = round.route.segments[person.segmentIndex];
  if (!segment) return person.position;
  const outwardX = markerPosition.x - anchor.x;
  const outwardY = markerPosition.y - anchor.y;
  const outwardLength = Math.hypot(outwardX, outwardY) || 1;
  const segmentLength = segment.length || 1;
  return {
    x:
      markerPosition.x +
      (outwardX / outwardLength) * 1.45 +
      ((segment.to.x - segment.from.x) / segmentLength) * 1.1,
    y:
      markerPosition.y +
      (outwardY / outwardLength) * 1.45 +
      ((segment.to.y - segment.from.y) / segmentLength) * 1.1,
  };
}

function crossingBridgeLine(
  round: Round,
  crossing: RouteCrossing,
): Readonly<{ x1: number; y1: number; x2: number; y2: number }> {
  const segment = round.route.segments[crossing.overSegmentIndex];
  const halfSpan = 1.8;
  const dx = (segment.to.x - segment.from.x) / segment.length;
  const dy = (segment.to.y - segment.from.y) / segment.length;
  return {
    x1: crossing.point.x - dx * halfSpan,
    y1: crossing.point.y - dy * halfSpan,
    x2: crossing.point.x + dx * halfSpan,
    y2: crossing.point.y + dy * halfSpan,
  };
}

function chevronPosition(
  round: Round,
  segmentIndex: number,
  crossings: readonly RouteCrossing[],
): Point {
  const candidates = [0.58, 0.3, 0.7].map((progress) =>
    segmentPosition(round, segmentIndex, progress),
  );
  const relevantCrossings = crossings.filter(
    ({ underSegmentIndex, overSegmentIndex }) =>
      underSegmentIndex === segmentIndex || overSegmentIndex === segmentIndex,
  );
  if (relevantCrossings.length === 0) return candidates[0];
  return [...candidates].sort((first, second) => {
    const firstClearance = Math.min(
      ...relevantCrossings.map(({ point }) =>
        Math.hypot(first.x - point.x, first.y - point.y),
      ),
    );
    const secondClearance = Math.min(
      ...relevantCrossings.map(({ point }) =>
        Math.hypot(second.x - point.x, second.y - point.y),
      ),
    );
    return secondClearance - firstClearance;
  })[0];
}

function CrossingBridge({
  round,
  crossing,
  trace = false,
}: {
  round: Round;
  crossing: RouteCrossing;
  trace?: boolean;
}) {
  const line = crossingBridgeLine(round, crossing);
  return (
    <g
      className={`${styles.crossingBridge} ${
        trace ? styles.traceCrossingBridge : ""
      }`}
      aria-hidden="true"
    >
      <line className={styles.crossingGap} {...line} />
      <line className={styles.crossingUnderlay} {...line} />
      <line
        className={trace ? styles.crossingTrace : styles.crossingLine}
        {...line}
      />
    </g>
  );
}

export function sequenceAccessibleLabel(
  round: Pick<Round, "people">,
  sequence: AnswerSequence,
): string {
  return namesForSequence(round, sequence).join(", then ");
}

export function Sequence({
  round,
  sequence,
  mismatchIndexes = [],
  compact = false,
}: {
  round: Pick<Round, "people">;
  sequence: AnswerSequence;
  mismatchIndexes?: readonly number[];
  compact?: boolean;
}) {
  const mismatches = new Set(mismatchIndexes);

  return (
    <span
      className={`${styles.sequence} ${compact ? styles.sequenceCompact : ""}`}
      aria-hidden="true"
    >
      {sequence.map((personId, index) => {
        const person = personForId(round, personId);
        return (
          <span className={styles.sequenceStep} key={`${personId}-${index}`}>
            {index > 0 ? (
              <span className={styles.sequenceArrow}>→</span>
            ) : null}
            <span
              className={`${styles.sequencePerson} ${personColorClass(person)} ${
                mismatches.has(index) ? styles.sequenceMismatch : ""
              }`}
            >
              <span className={styles.sequenceInitial}>{person.initial}</span>
              <span className={styles.sequenceName}>{person.name}</span>
            </span>
          </span>
        );
      })}
    </span>
  );
}

export function RouteBoard({
  round,
  revealSide = false,
  animateTrace = false,
  compact = false,
  completed = false,
  className = "",
}: {
  round: Round;
  revealSide?: boolean;
  animateTrace?: boolean;
  compact?: boolean;
  completed?: boolean;
  className?: string;
}) {
  const pathPoints = routePoints(round);
  const crossings = routeCrossings(round.route);
  const landmarkLinks = landmarkLinksForRound(round);
  const landmarkAnchors = new Map(
    landmarkLinks.map(({ person, anchor }) => [person.id, anchor]),
  );
  const landmarkMarkerPositions = new Map(
    landmarkLinks.map(({ person, markerPosition }) => [
      person.id,
      markerPosition,
    ]),
  );
  const targetOrder = new Map(
    round.correctSequence.map((personId, index) => [personId, index + 1]),
  );
  const finalPoint = round.route.points.at(-1) ?? round.route.points[0];
  const { minX, minY, width, height } = round.route.viewBox;
  const crossingDescription =
    crossings.length === 0
      ? ""
      : ` The route crosses over itself ${crossings.length} ${
          crossings.length === 1 ? "time" : "times"
        }; at each bridge gap, continue straight along the same strand.`;
  const tetherDescription =
    " Each letter has a short dotted tether to its assigned path section.";
  const boardLabel = completed
    ? `Completed visual route from Start to Finish. The highlighted ${
        round.querySide
      } side passes ${namesForSequence(round, round.correctSequence).join(
        ", then ",
      )}.${tetherDescription}${crossingDescription}`
    : `Visual route from Start to Finish with ${round.people.length} people beside successive path sections.${tetherDescription} Track the walker's changing ${round.querySide}; the answer is intentionally not encoded in this description.${crossingDescription}`;

  return (
    <figure
      className={`${styles.routeFigure} ${compact ? styles.routeCompact : ""} ${
        revealSide ? styles.routeRevealed : ""
      } ${animateTrace ? styles.routeAnimating : ""} ${
        round.querySide === "left" ? styles.sideLeft : styles.sideRight
      } ${className}`}
    >
      <figcaption className={styles.routePrompt}>
        <span className={styles.sideIcon} aria-hidden="true">
          {round.querySide === "left" ? "←" : "→"}
        </span>
        <span>
          Find <strong>{round.querySide}</strong>
        </span>
      </figcaption>

      <svg
        className={styles.routeSvg}
        viewBox={`${minX} ${minY} ${width} ${height}`}
        role="img"
        aria-label={boardLabel}
      >
        {landmarkLinks.map(({ person, anchor, markerPosition }) => (
          <line
            className={styles.landmarkTetherHalo}
            x1={anchor.x}
            y1={anchor.y}
            x2={markerPosition.x}
            y2={markerPosition.y}
            vectorEffect="non-scaling-stroke"
            aria-hidden="true"
            key={`link-halo-${person.id}`}
          />
        ))}
        <polyline
          className={styles.routeUnderlay}
          points={pathPoints}
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
        {landmarkLinks.map(({ person, anchor, markerPosition }) => {
          const order = targetOrder.get(person.id);
          const linkStyle = {
            "--visit-delay": `${Math.max(0, (order ?? 1) - 1) * 90}ms`,
          } as CustomProperties;
          return (
            <g
              className={styles.landmarkTether}
              style={linkStyle}
              aria-hidden="true"
              key={`link-${person.id}`}
            >
              <line
                className={styles.landmarkTetherLine}
                x1={anchor.x}
                y1={anchor.y}
                x2={markerPosition.x}
                y2={markerPosition.y}
                vectorEffect="non-scaling-stroke"
              />
              {revealSide && order !== undefined ? (
                <line
                  className={styles.sideLink}
                  x1={anchor.x}
                  y1={anchor.y}
                  x2={markerPosition.x}
                  y2={markerPosition.y}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </g>
          );
        })}
        <polyline
          className={styles.routeLine}
          points={pathPoints}
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
        {crossings.map((crossing) => (
          <CrossingBridge
            round={round}
            crossing={crossing}
            key={`bridge-${crossing.underSegmentIndex}-${crossing.overSegmentIndex}`}
          />
        ))}
        {revealSide ? (
          <>
            <polyline
              className={styles.routeTrace}
              points={pathPoints}
              fill="none"
              pathLength={1}
              vectorEffect="non-scaling-stroke"
            />
            {crossings.map((crossing) => (
              <CrossingBridge
                round={round}
                crossing={crossing}
                trace
                key={`trace-bridge-${crossing.underSegmentIndex}-${crossing.overSegmentIndex}`}
              />
            ))}
          </>
        ) : null}

        {round.scaffold.directionCueSegmentIndexes.map((segmentIndex) => {
          const position = chevronPosition(round, segmentIndex, crossings);
          return (
            <g
              className={styles.routeChevron}
              transform={`translate(${position.x} ${position.y}) rotate(${segmentAngle(
                round,
                segmentIndex,
              )})`}
              aria-hidden="true"
              key={`chevron-${segmentIndex}`}
            >
              <path d="M -1.35 -1.15 L 0 0 L -1.35 1.15" />
            </g>
          );
        })}

        {round.people.map((person) => {
          const segment = round.route.segments[person.segmentIndex];
          const order = targetOrder.get(person.id);
          const isTarget = order !== undefined;
          const anchor = landmarkAnchors.get(person.id) ?? person.position;
          const markerPosition =
            landmarkMarkerPositions.get(person.id) ?? person.position;
          const badgePosition = visitBadgePosition(
            round,
            person,
            anchor,
            markerPosition,
          );
          const visitStyle = {
            "--visit-delay": `${Math.max(0, (order ?? 1) - 1) * 90}ms`,
          } as CustomProperties;

          return (
            <g
              className={isTarget ? styles.targetPerson : undefined}
              style={visitStyle}
              aria-hidden="true"
              key={person.id}
            >
              <circle
                className={`${styles.personToken} ${personColorClass(person)}`}
                cx={markerPosition.x}
                cy={markerPosition.y}
                r={1.45}
                vectorEffect="non-scaling-stroke"
              />
              <text
                className={styles.personInitial}
                x={markerPosition.x}
                y={markerPosition.y}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {person.initial}
              </text>
              {isTarget && revealSide ? (
                <g className={styles.visitBadge}>
                  <circle
                    cx={badgePosition.x}
                    cy={badgePosition.y}
                    r={0.92}
                    vectorEffect="non-scaling-stroke"
                  />
                  <text
                    x={badgePosition.x}
                    y={badgePosition.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    {order}
                  </text>
                </g>
              ) : null}
              {!segment ? null : (
                <title>{`${person.name}, beside route section ${
                  person.segmentIndex + 1
                }`}</title>
              )}
            </g>
          );
        })}

        <g className={styles.endpoint} aria-hidden="true">
          <circle
            cx={round.route.points[0].x}
            cy={round.route.points[0].y}
            r={1.55}
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={round.route.points[0].x}
            y={round.route.points[0].y}
            textAnchor="middle"
            dominantBaseline="central"
          >
            S
          </text>
        </g>
        <g className={`${styles.endpoint} ${styles.finishEndpoint}`} aria-hidden="true">
          <circle
            cx={finalPoint.x}
            cy={finalPoint.y}
            r={1.55}
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={finalPoint.x}
            y={finalPoint.y}
            textAnchor="middle"
            dominantBaseline="central"
          >
            F
          </text>
        </g>
      </svg>

      <div className={styles.endpointKey} aria-hidden="true">
        <span><b>S</b> Start</span>
        <span><b>F</b> Finish</span>
        {crossings.length > 0 ? (
          <span className={styles.bridgeNote}>At bridges, keep straight</span>
        ) : null}
        {!round.scaffold.showIntermediateChevrons ? (
          <span className={styles.singleCueNote}>One direction cue</span>
        ) : null}
      </div>
    </figure>
  );
}
