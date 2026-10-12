import type { GameInfo, ShelfIconProps } from "@/lib/game-catalog-types";
import { progressionMetadata } from "./progression-metadata";

export const gameInfo = {
  title: "Folded Items",
  description:
    "Follow letters, numbers, and flowers through paper folds. Find the items hidden beneath the top one.",
  skills: ["Item tracking", "Spatial folding"],
  estimatedMinutes: 10,
  progression: progressionMetadata,
  shelfOrder: 42,
} satisfies GameInfo;

export function ShelfIcon({ style, ...props }: ShelfIconProps) {
  return (
    <svg
      {...props}
      viewBox="0 0 320 186"
      style={{ backgroundColor: "#f1eadc", ...style }}
    >
      <rect width="320" height="186" rx="13" fill="#f1eadc" />
      <g stroke="#17213d" strokeWidth="3" fill="#fffdf8">
        <rect x="28" y="35" width="112" height="112" rx="4" />
        <path d="M28 91h112M84 35v112" />
        <rect x="225" y="67" width="60" height="60" rx="4" />
      </g>
      <g fontFamily="sans-serif" fontWeight="800" fontSize="28" textAnchor="middle" fill="#17213d">
        <text x="56" y="74">A</text>
        <text x="112" y="74">B</text>
        <text x="56" y="130">C</text>
        <text x="112" y="130">D</text>
        <text x="255" y="107">A</text>
      </g>
      <path d="M151 84c16-21 39-21 55 0" fill="none" stroke="#17213d" strokeWidth="4" strokeLinecap="round" />
      <path d="m201 74 7 12-14-1" fill="#17213d" />
      <g fill="#35a999" stroke="#17213d" strokeWidth="2">
        <rect x="226" y="136" width="19" height="22" rx="3" />
        <rect x="246" y="136" width="19" height="22" rx="3" />
        <rect x="266" y="136" width="19" height="22" rx="3" />
      </g>
      <g fill="#17213d" fontFamily="sans-serif" fontSize="14" fontWeight="800" textAnchor="middle">
        <text x="235.5" y="152">B</text>
        <text x="255.5" y="152">C</text>
        <text x="275.5" y="152">D</text>
      </g>
      <path d="M22 91h124" stroke="#7767d7" strokeWidth="3" strokeDasharray="5 5" />
    </svg>
  );
}
