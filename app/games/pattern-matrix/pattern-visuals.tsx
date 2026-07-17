import {
  applyGridRule,
  applySequenceStep,
  combinePatterns,
  dotCount,
  makePattern,
  patternCells,
  patternKey,
  ruleLabel,
  transformPattern,
  type CueMode,
  type GridRule,
  type Matrix,
  type MatrixRule,
  type MotifFill,
  type MotifShape,
  type Pattern,
  type PatternTransform,
  type SequenceStep,
} from "./rule-engine";
import styles from "./pattern-matrix.module.css";

export type PatternSize =
  | "tutorialTile"
  | "matrixTile"
  | "optionTile"
  | "reviewTile"
  | "ghostTile"
  | "cueTile";

export type MatrixSize =
  | "tutorialMatrix"
  | "clueMatrix"
  | "reviewMatrix";

const SHAPE_CLASSES: Record<MotifShape, string> = {
  circle: styles.motifCircle,
  square: styles.motifSquare,
  triangle: styles.motifTriangle,
  bar: styles.motifBar,
};

const FILL_CLASSES: Record<MotifFill, string> = {
  solid: styles.motifSolid,
  outline: styles.motifOutline,
  striped: styles.motifStriped,
};

const OPERATION_SYMBOLS = {
  join: "∪",
  overlap: "∩",
  cancel: "⊕",
  "left-minus-right": "L−R",
  "right-minus-left": "R−L",
  match: "≡",
  neither: "∅",
} as const;

const TRANSFORM_SYMBOLS: Record<PatternTransform, string> = {
  none: "→",
  "rotate-clockwise": "↻¼",
  "rotate-half": "↻½",
  "rotate-counterclockwise": "↺¼",
};

const SEQUENCE_SYMBOLS: Record<SequenceStep, string> = {
  "rotate-clockwise": "↻¼",
  "rotate-counterclockwise": "↺¼",
  "move-clockwise": "↷",
  grow: "▸",
  shrink: "◂",
  "shape-cycle": "○▸△",
  "fill-cycle": "○▸●",
  "texture-shift": "≋▸",
  "motif-turn": "△↻",
};

type PatternStyle = React.CSSProperties & Record<`--${string}`, string>;

export function patternDescription(pattern: Pattern): string {
  const count = dotCount(pattern);
  const size = ["small", "medium", "large"][pattern.scale];
  const fill =
    pattern.fill === "striped" ? "striped" : `${pattern.fill}`;
  const shape = count === 1 ? pattern.shape : `${pattern.shape}s`;
  return `${count} ${size} ${fill} ${shape}`;
}

export function PatternTile({
  pattern,
  size,
  label,
  hidden = false,
  tileRef,
  differenceIndexes = [],
}: {
  pattern: Pattern;
  size: PatternSize;
  label?: string;
  hidden?: boolean;
  tileRef?: React.Ref<HTMLDivElement>;
  differenceIndexes?: readonly number[];
}) {
  const differenceSet = new Set(differenceIndexes);
  const motifStyle = {
    "--motif-scale": ["0.56", "0.72", "0.88"][pattern.scale],
    "--motif-turn": `${pattern.orientation * 90}deg`,
    "--texture-shift": `${pattern.texturePhase * 22}%`,
  } as PatternStyle;

  return (
    <div
      className={`${styles.patternTile} ${styles[size]}`}
      role={hidden ? undefined : "img"}
      aria-label={
        hidden ? undefined : (label ?? patternDescription(pattern))
      }
      aria-hidden={hidden || undefined}
      ref={tileRef}
    >
      {patternCells(pattern).map((filled, index) => (
        <span
          className={`${styles.dot} ${
            filled ? styles.dotFilled : styles.dotEmpty
          } ${differenceSet.has(index) ? styles.differenceDot : ""}`}
          aria-hidden="true"
          key={`${index}-${Number(filled)}`}
        >
          {filled ? (
            <span
              className={`${styles.motif} ${
                SHAPE_CLASSES[pattern.shape]
              } ${FILL_CLASSES[pattern.fill]}`}
              style={motifStyle}
            />
          ) : null}
        </span>
      ))}
    </div>
  );
}

export function MatrixBoard({
  matrix,
  answer,
  size,
  label,
  missingRef,
  highlightFinalRow = false,
  showSolvedMark = false,
}: {
  matrix: Matrix;
  answer?: Pattern;
  size: MatrixSize;
  label: string;
  missingRef?: React.Ref<HTMLDivElement>;
  highlightFinalRow?: boolean;
  showSolvedMark?: boolean;
}) {
  return (
    <div
      className={`${styles.matrix} ${styles[size]} ${
        answer ? styles.matrixComplete : ""
      }`}
      role="img"
      aria-label={label}
    >
      {matrix.map((pattern, index) => {
        const finalRow = index >= 6;
        const cellClass = `${styles.matrixCell} ${
          finalRow && highlightFinalRow ? styles.matrixCellRelated : ""
        }`;

        if (pattern) {
          return (
            <span className={cellClass} aria-hidden="true" key={index}>
              <PatternTile pattern={pattern} size="matrixTile" hidden />
            </span>
          );
        }

        return (
          <div
            className={`${cellClass} ${styles.missingCell} ${
              answer ? styles.filledMissingCell : ""
            }`}
            aria-hidden="true"
            ref={missingRef}
            key={index}
          >
            {answer ? (
              <>
                <PatternTile pattern={answer} size="matrixTile" hidden />
                {showSolvedMark ? (
                  <span className={styles.solvedMark}>✓</span>
                ) : null}
              </>
            ) : (
              <span className={styles.missingMark}>?</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function combineExample(rule: Extract<MatrixRule, { family: "combine" }>) {
  const style = {
    shape: "triangle",
    fill: "striped",
    scale: 1,
    orientation: 0,
    texturePhase: 0,
  } as const;
  const left = makePattern(0b1001, style);
  const right = makePattern(0b0011, style);
  const intermediate = combinePatterns(left, right, rule.operation);
  if (!intermediate) return null;
  return {
    left,
    right,
    intermediate,
    result: transformPattern(intermediate, rule.transform),
  };
}

function sequenceExample(
  step: SequenceStep,
): readonly [Pattern, Pattern, Pattern] {
  const base =
    step === "texture-shift"
      ? makePattern(0b0111, {
          shape: "triangle",
          fill: "striped",
          scale: 1,
          orientation: 0,
          texturePhase: 0,
        })
      : step === "motif-turn"
        ? makePattern(0b0101, {
            shape: "triangle",
            fill: "outline",
            scale: 1,
            orientation: 0,
          })
        : step === "grow"
          ? makePattern(0b1001, {
              shape: "circle",
              fill: "solid",
              scale: 0,
            })
          : step === "shrink"
            ? makePattern(0b1001, {
                shape: "square",
                fill: "outline",
                scale: 2,
              })
            : makePattern(0b0111, {
                shape: step === "shape-cycle" ? "circle" : "bar",
                fill: step === "fill-cycle" ? "solid" : "outline",
                scale: 1,
                orientation: 0,
              });
  const second = applySequenceStep(base, step) ?? base;
  const third = applySequenceStep(second, step) ?? second;
  return [base, second, third];
}

function gridExample(rule: GridRule): readonly Pattern[] {
  const style = {
    shape: "triangle",
    fill: "outline",
    scale: 1,
    orientation: 0,
    texturePhase: 0,
  } as const;
  for (let first = 1; first <= 0b1111; first += 1) {
    for (let second = 1; second <= 0b1111; second += 1) {
      for (let third = 1; third <= 0b1111; third += 1) {
        const completed = applyGridRule(
          [
            makePattern(first, style),
            makePattern(second, style),
            makePattern(third, style),
          ],
          rule,
        );
        const keys = completed.map((pattern) => patternKey(pattern));
        if (
          completed.every((pattern) => pattern.mask !== 0) &&
          new Set(keys).size === keys.length
        ) {
          return completed;
        }
      }
    }
  }
  throw new Error("Unable to build a visual example for the matrix cascade.");
}

function RuleAxis({ axis }: { axis: "rows" | "columns" }) {
  return (
    <span className={styles.ruleAxis} aria-hidden="true">
      {axis === "rows" ? "↔" : "↕"}
    </span>
  );
}

export function RuleCue({
  rule,
  cueMode,
  compact = false,
}: {
  rule: MatrixRule;
  cueMode: CueMode;
  compact?: boolean;
}) {
  if (cueMode === "hidden") {
    return (
      <div
        className={`${styles.ruleCue} ${styles.hiddenRuleCue} ${
          compact ? styles.compactRuleCue : ""
        }`}
        role="img"
        aria-label="Infer the complete rule from all visible evidence"
      >
        <span aria-hidden="true">?</span>
      </div>
    );
  }

  if (rule.family === "combine") {
    const example = combineExample(rule);
    if (!example) return null;
    return (
      <div
        className={`${styles.ruleCue} ${styles.visualRuleCue} ${
          compact ? styles.compactRuleCue : ""
        }`}
        role="img"
        aria-label={ruleLabel(rule)}
      >
        <RuleAxis axis={rule.axis} />
        <PatternTile pattern={example.left} size="cueTile" hidden />
        <span className={styles.operationSymbol} aria-hidden="true">
          {OPERATION_SYMBOLS[rule.operation]}
        </span>
        <PatternTile pattern={example.right} size="cueTile" hidden />
        <span className={styles.transformSymbol} aria-hidden="true">
          {rule.transform === "none" ? "→" : "⇒"}
        </span>
        {rule.transform !== "none" ? (
          <>
            <PatternTile
              pattern={example.intermediate}
              size="cueTile"
              hidden
            />
            <span className={styles.transformSymbol} aria-hidden="true">
              {TRANSFORM_SYMBOLS[rule.transform]}
            </span>
          </>
        ) : null}
        <PatternTile pattern={example.result} size="cueTile" hidden />
      </div>
    );
  }

  if (rule.family === "sequence") {
    const example = sequenceExample(rule.step);
    return (
      <div
        className={`${styles.ruleCue} ${styles.visualRuleCue} ${
          compact ? styles.compactRuleCue : ""
        }`}
        role="img"
        aria-label={ruleLabel(rule)}
      >
        <RuleAxis axis={rule.axis} />
        {example.map((pattern, index) => (
          <span className={styles.sequenceCueStep} key={index}>
            {index > 0 ? (
              <span className={styles.transformSymbol} aria-hidden="true">
                {SEQUENCE_SYMBOLS[rule.step]}
              </span>
            ) : null}
            <PatternTile pattern={pattern} size="cueTile" hidden />
          </span>
        ))}
      </div>
    );
  }

  return (
    <div
      className={`${styles.ruleCue} ${styles.visualRuleCue} ${
        styles.gridRuleCue
      } ${compact ? styles.compactRuleCue : ""}`}
      role="img"
      aria-label={ruleLabel(rule)}
    >
      <span className={styles.gridCue} aria-hidden="true">
        {gridExample(rule).map((pattern, index) => (
          <PatternTile
            pattern={pattern}
            size="cueTile"
            hidden
            key={index}
          />
        ))}
      </span>
      <span className={styles.gridCueArrows} aria-hidden="true">
        <span>
          {OPERATION_SYMBOLS[rule.operation]} ⇒{" "}
          {TRANSFORM_SYMBOLS[rule.transform]}
        </span>
        <span>↘ ↙ ↗</span>
      </span>
    </div>
  );
}
