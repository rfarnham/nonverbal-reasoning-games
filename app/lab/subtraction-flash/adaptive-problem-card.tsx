import type {
  EquationMathSpec,
  GeneratedProblem,
  PlaceValueMathSpec,
  ProblemFormat,
} from "./adaptive/types";
import styles from "./adaptive-curriculum.module.css";

function visibleTerm(value: number | null): React.ReactNode {
  return value === null ? (
    <span className={styles.unknown}>?</span>
  ) : (
    value
  );
}

function spokenTerm(value: number | null): string {
  return value === null ? "a missing number" : String(value);
}

function Equation({
  spec,
  format,
}: Readonly<{ spec: EquationMathSpec; format: ProblemFormat }>) {
  const accessible = `${spokenTerm(spec.left)} ${
    spec.operator === "+" ? "plus" : "minus"
  } ${spokenTerm(spec.right)} equals ${spokenTerm(spec.result)}`;

  if (
    format === "vertical" &&
    spec.operator === "-" &&
    spec.left !== null &&
    spec.right !== null &&
    spec.missing === "result"
  ) {
    return (
      <div
        className={styles.equation}
        data-format="vertical"
        role="img"
        aria-label={`Vertical subtraction: ${spec.left} minus ${spec.right}`}
      >
        <span className={styles.verticalTop} aria-hidden="true">
          {spec.left}
        </span>
        <span className={styles.verticalOperator} aria-hidden="true">
          −
        </span>
        <span className={styles.verticalBottom} aria-hidden="true">
          {spec.right}
        </span>
        <span className={styles.verticalRule} aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className={styles.equation} role="img" aria-label={accessible}>
      <span aria-hidden="true">{visibleTerm(spec.left)}</span>
      <span className={styles.operator} aria-hidden="true">
        {spec.operator === "+" ? "+" : "−"}
      </span>
      <span aria-hidden="true">{visibleTerm(spec.right)}</span>
      <span aria-hidden="true">=</span>
      <span aria-hidden="true">{visibleTerm(spec.result)}</span>
    </div>
  );
}

function placeValueDisplay(spec: PlaceValueMathSpec): {
  heading: string;
  detail: string;
} {
  switch (spec.question) {
    case "renamed_tens":
      return {
        heading: String(spec.whole),
        detail: "After trading one ten, how many tens remain?",
      };
    case "renamed_ones":
      return {
        heading: String(spec.whole),
        detail: "After trading one ten, how many ones are there?",
      };
    case "ones_after_regrouping":
      return {
        heading: `${spec.renamedOnes ?? "?"} − ${
          spec.subtrahendOnes ?? "?"
        }`,
        detail: "Subtract just the ones after the trade.",
      };
    case "tens_after_regrouping":
      return {
        heading: `${spec.renamedTens ?? "?"} − ${
          spec.subtrahendTens ?? "?"
        }`,
        detail: "How many tens remain in the answer?",
      };
    case "assembled_value":
      return {
        heading: `${spec.answerTens ?? "?"} tens + ${
          spec.answerOnes ?? "?"
        } ones`,
        detail: "Put the tens and ones together.",
      };
  }
}

export function AdaptiveProblemCard({
  problem,
}: Readonly<{ problem: GeneratedProblem }>) {
  const { promptSpec } = problem;
  const math = promptSpec.math;

  let content: React.ReactNode;
  if (math.kind === "equation") {
    content = <Equation spec={math} format={promptSpec.format} />;
  } else if (math.kind === "regrouping-decision") {
    content = (
      <div className={styles.placeValue}>
        <strong aria-hidden="true">
          {math.minuend} − {math.subtrahend}
        </strong>
        <span>Do you need to trade one ten?</span>
      </div>
    );
  } else if (math.kind === "place-value") {
    const display = placeValueDisplay(math);
    content = (
      <div className={styles.placeValue}>
        <strong aria-hidden="true">{display.heading}</strong>
        <span>{display.detail}</span>
      </div>
    );
  } else {
    content = (
      <div className={styles.repair}>
        <strong aria-hidden="true">
          {math.minuend} {math.operation === "addition" ? "+" : "−"}{" "}
          {math.subtrahend} = {math.shownAnswer}
        </strong>
        <span>Find the answer that repairs this work.</span>
      </div>
    );
  }

  return (
    <article
      className={styles.promptCard}
      aria-label={`${promptSpec.instruction} ${promptSpec.displayText}`}
    >
      <p className={styles.instruction}>{promptSpec.instruction}</p>
      {content}
    </article>
  );
}
