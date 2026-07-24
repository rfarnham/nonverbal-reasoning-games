import type {
  GameInfo,
  ShelfIconProps,
} from "@/lib/game-catalog-types";
import { progressionMetadata } from "./progression-metadata";

export const gameInfo = {
  title: "Extra Piece",
  description:
    "Turn patterned pieces in your mind and find the one that cannot belong in the square.",
  skills: ["Spatial composition", "Mental rotation", "Chirality"],
  estimatedMinutes: 12,
  progression: progressionMetadata,
  shelfOrder: 85,
} satisfies GameInfo;

export function ShelfIcon({ style, ...props }: ShelfIconProps) {
  const cells = [
    [78, 34, "#f06f5f"],
    [110, 34, "#f06f5f"],
    [142, 34, "#f3bd4e"],
    [174, 34, "#35a999"],
    [78, 66, "#7767d7"],
    [110, 66, "#f3bd4e"],
    [142, 66, "#f3bd4e"],
    [174, 66, "#35a999"],
    [78, 98, "#7767d7"],
    [110, 98, "#7767d7"],
    [142, 98, "#35a999"],
    [174, 98, "#35a999"],
    [78, 130, "#7767d7"],
    [110, 130, "#f06f5f"],
    [142, 130, "#f06f5f"],
    [174, 130, "#f3bd4e"],
  ] as const;
  return (
    <svg
      {...props}
      viewBox="0 0 320 186"
      style={{ backgroundColor: "#f1eadc", ...style }}
    >
      <rect width="320" height="186" rx="13" fill="#f1eadc" />
      <g stroke="#17213d" strokeWidth="3">
        {cells.map(([x, y, fill]) => (
          <rect
            x={x}
            y={y}
            width="32"
            height="32"
            fill={fill}
            key={`${x}-${y}`}
          />
        ))}
      </g>
      <path
        d="M222 48h26v26h26v26h-52Z"
        fill="#fffdf8"
        stroke="#17213d"
        strokeLinejoin="round"
        strokeWidth="4"
      />
      <path
        d="m236 120 12 12 24-27"
        fill="none"
        stroke="#16836b"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="6"
      />
    </svg>
  );
}
