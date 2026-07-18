import {
  combinePatterns,
  dotCount,
  operationLabel,
  operationSymbol,
  patternCells,
  ruleLabel,
  sequenceLabel,
  sequenceSymbol,
  transformSymbol,
  type CueMode,
  type Matrix,
  type MatrixRule,
  type MotifFill,
  type MotifShape,
  type Pattern,
  type RulePart,
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

function evidenceLine(
  matrix: Matrix,
  axis: "rows" | "columns",
): readonly [Pattern, Pattern, Pattern] {
  const indexes =
    axis === "rows" ? ([0, 1, 2] as const) : ([0, 3, 6] as const);
  const patterns = indexes.map((index) => matrix[index]);
  if (patterns.some((pattern) => pattern === null)) {
    throw new Error("A rule cue requires one complete evidence line.");
  }
  return patterns as unknown as readonly [Pattern, Pattern, Pattern];
}

function CueHeader({
  symbol,
  name,
  direction,
}: {
  symbol: string;
  name: string;
  direction: string;
}) {
  const hasLongNotation = symbol.length > 4;

  return (
    <span className={styles.ruleCueHeader} aria-hidden="true">
      <span
        className={`${styles.ruleNotation} ${
          hasLongNotation ? styles.longRuleNotation : ""
        }`}
      >
        {symbol}
      </span>
      <strong>{name}</strong>
      <small>{direction}</small>
    </span>
  );
}

function PatternEquation({
  patterns,
  operator,
  axis,
}: {
  patterns: readonly [Pattern, Pattern, Pattern];
  operator: string;
  axis: "rows" | "columns";
}) {
  return (
    <span
      className={`${styles.cueEquation} ${
        axis === "columns" ? styles.cueEquationColumn : ""
      }`}
      aria-hidden="true"
    >
      <PatternTile pattern={patterns[0]} size="cueTile" hidden />
      <span className={styles.operationSymbol}>{operator}</span>
      <PatternTile pattern={patterns[1]} size="cueTile" hidden />
      <span className={styles.equalsSymbol}>=</span>
      <PatternTile pattern={patterns[2]} size="cueTile" hidden />
    </span>
  );
}

function SequenceEquation({
  patterns,
  symbol,
  axis,
}: {
  patterns: readonly [Pattern, Pattern, Pattern];
  symbol: string;
  axis: "rows" | "columns";
}) {
  return (
    <span
      className={`${styles.cueEquation} ${
        axis === "columns" ? styles.cueEquationColumn : ""
      }`}
      aria-hidden="true"
    >
      <PatternTile pattern={patterns[0]} size="cueTile" hidden />
      <span className={styles.transformSymbol}>{symbol}</span>
      <PatternTile pattern={patterns[1]} size="cueTile" hidden />
      <span className={styles.transformSymbol}>{symbol}</span>
      <PatternTile pattern={patterns[2]} size="cueTile" hidden />
    </span>
  );
}

export function RulePartLessonCue({ part }: { part: RulePart }) {
  return (
    <div
      className={styles.rulePartLessonCue}
      role="img"
      aria-label={`${part.name}. ${part.description}`}
    >
      <span aria-hidden="true">{part.symbol}</span>
      <strong>{part.shortName}</strong>
    </div>
  );
}

export function RuleCue({
  rule,
  matrix,
  cueMode,
  compact = false,
}: {
  rule: MatrixRule;
  matrix: Matrix;
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
    const evidence = evidenceLine(matrix, rule.axis);
    const intermediate = combinePatterns(
      evidence[0],
      evidence[1],
      rule.operation,
    );
    if (!intermediate) return null;

    return (
      <div
        className={`${styles.ruleCue} ${styles.visualRuleCue} ${
          compact ? styles.compactRuleCue : ""
        }`}
        role="img"
        aria-label={ruleLabel(rule)}
      >
        <CueHeader
          symbol={operationSymbol(rule.operation)}
          name={operationLabel(rule.operation)}
          direction={rule.axis === "rows" ? "rows →" : "columns ↓"}
        />
        <PatternEquation
          patterns={[
            evidence[0],
            evidence[1],
            rule.transform === "none" ? evidence[2] : intermediate,
          ]}
          operator={operationSymbol(rule.operation)}
          axis={rule.axis}
        />
        {rule.transform !== "none" ? (
          <span className={styles.cueSecondStage} aria-hidden="true">
            <small>then</small>
            <span className={styles.cueEquation}>
              <PatternTile pattern={intermediate} size="cueTile" hidden />
              <span className={styles.transformSymbol}>
                {transformSymbol(rule.transform)}
              </span>
              <span className={styles.equalsSymbol}>=</span>
              <PatternTile pattern={evidence[2]} size="cueTile" hidden />
            </span>
          </span>
        ) : null}
      </div>
    );
  }

  if (rule.family === "sequence") {
    const evidence = evidenceLine(matrix, rule.axis);
    return (
      <div
        className={`${styles.ruleCue} ${styles.visualRuleCue} ${
          compact ? styles.compactRuleCue : ""
        }`}
        role="img"
        aria-label={ruleLabel(rule)}
      >
        <CueHeader
          symbol={sequenceSymbol(rule.step)}
          name={sequenceLabel(rule.step)}
          direction={rule.axis === "rows" ? "rows →" : "columns ↓"}
        />
        <SequenceEquation
          patterns={evidence}
          symbol={sequenceSymbol(rule.step)}
          axis={rule.axis}
        />
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
      <CueHeader
        symbol="f∘f"
        name="Matrix cascade"
        direction="whole grid"
      />
      <span className={styles.cascadeDefinition} aria-hidden="true">
        <strong>f(A,B)</strong>
        <span>=</span>
        <span>{transformSymbol(rule.transform)}</span>
        <span>(A {operationSymbol(rule.operation)} B)</span>
      </span>
      <span className={styles.cascadeTrace} aria-hidden="true">
        <span className={styles.cascadeMap}>
          {["A", "B", "C", "D", "E", "F", "G", "H", "?"].map(
            (label) => <span key={label}>{label}</span>,
          )}
        </span>
        <span className={styles.cascadeSteps}>
          <span>f(A,B)=C</span>
          <span>f(A,D)=G</span>
          <span>f(B,D)=E</span>
          <span>f(C,E)=F</span>
          <span>f(E,G)=H</span>
          <span>f(F,H)=?</span>
        </span>
      </span>
    </div>
  );
}
