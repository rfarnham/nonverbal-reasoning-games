import type {
  GameInfo,
  ShelfIconProps,
} from "@/lib/game-catalog-types";
import { progressionMetadata } from "./progression-metadata";

export const gameInfo = {
  title: "Bracelet Search",
  description:
    "Scan a circular bracelet from either side and find the one bead run hidden within it.",
  skills: ["Sequence search", "Mental reversal"],
  estimatedMinutes: 10,
  progression: progressionMetadata,
  shelfOrder: 50,
} satisfies GameInfo;

export function ShelfIcon({ style, ...props }: ShelfIconProps) {
  const beads = [
    [160, 27, "#f06f5f"],
    [206, 36, "#f3bd4e"],
    [239, 62, "#35a999"],
    [250, 96, "#7767d7"],
    [234, 126, "#f06f5f"],
    [199, 145, "#35a999"],
    [121, 145, "#7767d7"],
    [86, 126, "#f3bd4e"],
    [70, 96, "#35a999"],
    [81, 62, "#f06f5f"],
    [114, 36, "#7767d7"],
  ] as const;

  return (
    <svg
      {...props}
      viewBox="0 0 320 186"
      style={{ backgroundColor: "#f1eadc", ...style }}
    >
      <rect width="320" height="186" rx="13" fill="#f1eadc" />
      <ellipse
        cx="160"
        cy="88"
        rx="93"
        ry="64"
        fill="none"
        stroke="#cfcabd"
        strokeWidth="4"
      />
      {beads.map(([cx, cy, fill], index) => (
        <circle
          key={`${cx}-${cy}`}
          cx={cx}
          cy={cy}
          r={index >= 3 && index <= 5 ? 16 : 13}
          fill={fill}
          stroke="#17213d"
          strokeWidth={index >= 3 && index <= 5 ? 4 : 3}
        />
      ))}
      <path
        d="M258 70c8 18 6 39-5 56"
        fill="none"
        stroke="#17213d"
        strokeLinecap="round"
        strokeWidth="5"
      />
      <path d="m248 126 11-2-4 11Z" fill="#17213d" />
      <g transform="translate(113 157)">
        <path
          d="M-16 0h126"
          fill="none"
          stroke="#17213d"
          strokeLinecap="round"
          strokeWidth="5"
        />
        <circle cx="9" cy="0" r="13" fill="#7767d7" stroke="#17213d" strokeWidth="3" />
        <circle cx="47" cy="0" r="13" fill="#35a999" stroke="#17213d" strokeWidth="3" />
        <circle cx="85" cy="0" r="13" fill="#f06f5f" stroke="#17213d" strokeWidth="3" />
      </g>
    </svg>
  );
}
