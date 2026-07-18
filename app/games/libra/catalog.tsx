import type {
  GameInfo,
  ShelfIconProps,
} from "@/lib/game-catalog-types";

export const gameInfo = {
  title: "Libra",
  description:
    "Combine, subtract, and regroup balanced animal scales to find the exact load.",
  skills: ["Relational reasoning", "Visual equivalence"],
  estimatedMinutes: 10,
  shelfOrder: 30,
} satisfies GameInfo;

export function ShelfIcon({ style, ...props }: ShelfIconProps) {
  return (
    <svg
      {...props}
      viewBox="0 0 320 186"
      style={{ backgroundColor: "#f2dfd6", ...style }}
    >
      <rect width="320" height="186" rx="13" fill="#f2dfd6" />
      <path
        d="M160 58 126 154h68Z"
        fill="#17213d"
        stroke="#17213d"
        strokeLinejoin="round"
        strokeWidth="5"
      />
      <path
        d="M58 80 260 72"
        fill="none"
        stroke="#17213d"
        strokeLinecap="round"
        strokeWidth="8"
      />
      <circle
        cx="160"
        cy="76"
        r="12"
        fill="#fffdf8"
        stroke="#17213d"
        strokeWidth="5"
      />
      <g fill="none" stroke="#17213d" strokeWidth="3">
        <path d="M82 79 66 126M82 79l25 45" />
        <path d="M235 73 215 119m20-46 22 44" />
      </g>
      <path
        d="M49 124q28 24 57-2"
        fill="#fffdf8"
        stroke="#17213d"
        strokeWidth="5"
      />
      <path
        d="M201 117q28 24 57-2"
        fill="#fffdf8"
        stroke="#17213d"
        strokeWidth="5"
      />
      <g stroke="#17213d" strokeWidth="3">
        <g fill="#f06f5f">
          <circle cx="78" cy="108" r="17" />
          <path
            d="m66 94-5-14 13 8m15 5 7-13-14 7"
            strokeLinejoin="round"
          />
        </g>
        <g fill="#f3bd4e">
          <circle cx="220" cy="103" r="13" />
          <path
            d="m212 92-3-10 9 6m10 3 5-9-10 5"
            strokeLinejoin="round"
          />
          <circle cx="242" cy="102" r="13" />
          <path
            d="m234 91-3-10 9 6m10 3 5-9-10 5"
            strokeLinejoin="round"
          />
        </g>
      </g>
    </svg>
  );
}
