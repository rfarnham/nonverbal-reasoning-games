import styles from "./order-cue.module.css";

export type RecallOrder = "same" | "reverse" | "ascending" | "descending";

const ORDERS = {
  same: {
    label: "Same order",
    description: "Recall in the original order, from first to last.",
  },
  reverse: {
    label: "Reverse order",
    description: "Recall in reverse order, from last to first.",
  },
  ascending: {
    label: "Small → large",
    description: "Recall in ascending order, from the smallest number to the largest.",
  },
  descending: {
    label: "Large → small",
    description: "Recall in descending order, from the largest number to the smallest.",
  },
} as const;

function OrderShape({ shape, x }: { shape: number; x: number }) {
  if (shape === 0) return <circle cx={x} cy={21} r={7} />;
  if (shape === 1)
    return <path d={`M${x} 13l8 15H${x - 8}Z`} />;
  return <rect x={x - 7} y={14} width={14} height={14} />;
}

/** Abstract operation icons, with no digits to compete with auditory recall. */
export default function OrderCue({ mode }: { mode: RecallOrder }) {
  const order = ORDERS[mode];
  const sorted = mode === "ascending" || mode === "descending";
  return (
    <div
      className={styles.cue}
      role="group"
      aria-label={order.description}
      data-recall-order={mode}
    >
      <div className={styles.caption} aria-hidden="true">
        <strong>{order.label}</strong>
      </div>
      <svg
        className={styles.diagram}
        viewBox="0 0 202 42"
        aria-hidden="true"
        focusable="false"
      >
        {sorted ? (
          <>
            {(mode === "ascending" ? [9, 19, 29] : [29, 19, 9]).map(
              (height, i) => (
                <rect
                  key={i}
                  className={styles.output}
                  x={36 + i * 51}
                  y={40 - height}
                  width={18}
                  height={height}
                />
              ),
            )}
            <path
              className={styles.arrow}
              d={
                mode === "ascending"
                  ? "M37 23 160 3m-8-2 8 2-6 6"
                  : "M37 3 160 23m-6-7 6 7-8 3"
              }
            />
          </>
        ) : (
          <>
            <g className={styles.input}>
              {[0, 1, 2].map((shape, i) => (
                <OrderShape key={i} shape={shape} x={12 + i * 25} />
              ))}
            </g>
            <path className={styles.arrow} d="M82 21h24m-6-6 6 6-6 6" />
            <g className={styles.output}>
              {(mode === "reverse" ? [2, 1, 0] : [0, 1, 2]).map(
                (shape, i) => (
                  <OrderShape key={i} shape={shape} x={130 + i * 25} />
                ),
              )}
            </g>
          </>
        )}
      </svg>
    </div>
  );
}
