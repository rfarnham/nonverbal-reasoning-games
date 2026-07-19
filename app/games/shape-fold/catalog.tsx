import type {
  GameInfo,
  ShelfIconProps,
} from "@/lib/game-catalog-types";

export const gameInfo = {
  title: "Shape Fold",
  description:
    "Track each fold, then predict the exact pattern a single punch makes when the sheet opens.",
  skills: ["Spatial folding", "Visual prediction"],
  estimatedMinutes: 10,
  shelfOrder: 40,
} satisfies GameInfo;

export function ShelfIcon({ style, ...props }: ShelfIconProps) {
  return (
    <svg
      {...props}
      viewBox="0 0 320 186"
      style={{ backgroundColor: "#f5dfd5", ...style }}
    >
      <rect width="320" height="186" rx="13" fill="#f5dfd5" />
      <g transform="rotate(-3 132 92)">
        <rect
          x="61"
          y="25"
          width="128"
          height="136"
          rx="9"
          fill="#fffdf8"
          stroke="#17213d"
          strokeWidth="4"
        />
        <path
          d="M125 25v136"
          fill="none"
          stroke="#a49d91"
          strokeDasharray="7 6"
          strokeWidth="3"
        />
        <g stroke="#ddd7cb" strokeWidth="1">
          <path d="M61 59h128M61 93h128M61 127h128" />
          <path d="M93 25v136M157 25v136" />
        </g>
      </g>
      <path
        d="M141 42c32 1 50 18 57 45"
        fill="none"
        stroke="#17213d"
        strokeLinecap="round"
        strokeWidth="6"
      />
      <path d="m207 78-7 22-16-17Z" fill="#17213d" />
      <g transform="rotate(3 202 94)">
        <path
          d="M154 28h74a12 12 0 0 1 12 12v108a12 12 0 0 1-12 12h-74Z"
          fill="#f3bd4e"
          stroke="#17213d"
          strokeLinejoin="round"
          strokeWidth="4"
        />
        <path
          d="M154 28v132"
          fill="none"
          stroke="#17213d"
          strokeWidth="4"
        />
        <circle
          cx="205"
          cy="92"
          r="10"
          fill="#17213d"
          stroke="#fffdf8"
          strokeWidth="5"
        />
      </g>
    </svg>
  );
}
