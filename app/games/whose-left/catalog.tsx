import type {
  GameInfo,
  ShelfIconProps,
} from "@/lib/game-catalog-types";
import { progressionMetadata } from "./progression-metadata";

export const gameInfo = {
  title: "Whose Left?",
  description:
    "Follow winding, crossing paths and keep left and right anchored to the walker, not the page.",
  skills: ["Spatial perspective", "Direction tracking"],
  estimatedMinutes: 10,
  progression: progressionMetadata,
  shelfOrder: 40,
} satisfies GameInfo;

export function ShelfIcon({ style, ...props }: ShelfIconProps) {
  return (
    <svg
      {...props}
      viewBox="0 0 320 186"
      style={{ backgroundColor: "#f1eadc", ...style }}
    >
      <rect width="320" height="186" rx="13" fill="#f1eadc" />
      <path
        d="M52 132h162V50H96v54h154"
        fill="none"
        stroke="#d8d1c3"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="19"
      />
      <path
        d="M52 132h162V50H96v54h154"
        fill="none"
        stroke="#17213d"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="9"
      />
      <path
        d="M201 104h26"
        fill="none"
        stroke="#f1eadc"
        strokeLinecap="round"
        strokeWidth="23"
      />
      <path
        d="M201 104h26"
        fill="none"
        stroke="#d8d1c3"
        strokeLinecap="round"
        strokeWidth="19"
      />
      <path
        d="M201 104h26"
        fill="none"
        stroke="#17213d"
        strokeLinecap="round"
        strokeWidth="9"
      />
      <circle cx="52" cy="132" r="17" fill="#17213d" />
      <text
        x="52"
        y="138"
        fill="#fffdf8"
        fontFamily="ui-monospace, monospace"
        fontSize="15"
        fontWeight="900"
        textAnchor="middle"
      >
        S
      </text>
      <circle
        cx="250"
        cy="104"
        r="17"
        fill="#fffdf8"
        stroke="#17213d"
        strokeWidth="3"
      />
      <text
        x="250"
        y="110"
        fill="#17213d"
        fontFamily="ui-monospace, monospace"
        fontSize="15"
        fontWeight="900"
        textAnchor="middle"
      >
        F
      </text>
      <g stroke="#17213d" strokeWidth="3">
        <circle cx="126" cy="155" r="19" fill="#f06f5f" />
        <circle cx="72" cy="76" r="19" fill="#35a999" />
      </g>
      <g
        fill="#17213d"
        fontFamily="Inter, sans-serif"
        fontSize="16"
        fontWeight="900"
        textAnchor="middle"
      >
        <text x="126" y="161">A</text>
        <text x="72" y="82">B</text>
      </g>
      <path
        d="M146 104h22m-8-8 8 8-8 8"
        fill="none"
        stroke="#fffdf8"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="4"
      />
    </svg>
  );
}
