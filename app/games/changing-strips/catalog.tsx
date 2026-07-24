import type {
  GameInfo,
  ShelfIconProps,
} from "@/lib/game-catalog-types";
import { progressionMetadata } from "./progression-metadata";

export const gameInfo = {
  title: "Changing Strips",
  description:
    "Apply every black-and-white pattern change in numbered order.",
  skills: ["Visual sequencing", "Multi-step reasoning"],
  estimatedMinutes: 10,
  progression: progressionMetadata,
  shelfOrder: 45,
} satisfies GameInfo;

const SOURCE = [
  "solid",
  "hollow",
  "striped",
  "hollow",
  "solid",
  "striped",
] as const;
const RESULT = [
  "hollow",
  "hollow",
  "solid",
  "hollow",
  "hollow",
  "solid",
] as const;

function ShelfTile({
  state,
  x,
  y,
}: Readonly<{
  state: (typeof SOURCE)[number];
  x: number;
  y: number;
}>) {
  const fill =
    state === "solid"
      ? "#111827"
      : state === "striped"
        ? "url(#changing-strips-shelf-stripes)"
        : "#fffdf8";

  return (
    <g>
      <rect
        x={x}
        y={y}
        width="30"
        height="30"
        rx="4"
        fill={fill}
        stroke="#17213d"
        strokeWidth="2.5"
      />
      {state === "hollow" ? (
        <circle
          cx={x + 15}
          cy={y + 15}
          r="6"
          fill="none"
          stroke="#17213d"
          strokeWidth="2.5"
        />
      ) : null}
    </g>
  );
}

export function ShelfIcon({ style, ...props }: ShelfIconProps) {
  return (
    <svg
      {...props}
      viewBox="0 0 320 186"
      style={{ backgroundColor: "#f3eadc", ...style }}
    >
      <defs>
        <pattern
          id="changing-strips-shelf-stripes"
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-45)"
        >
          <rect width="8" height="8" fill="#fffdf8" />
          <rect width="4" height="8" fill="#111827" />
        </pattern>
      </defs>
      <rect width="320" height="186" rx="13" fill="#f3eadc" />

      <g transform="translate(61 23)">
        {SOURCE.map((state, index) => (
          <ShelfTile
            state={state}
            x={index * 33}
            y={0}
            key={`source-${index}`}
          />
        ))}
      </g>

      <g transform="translate(138 57)">
        <rect
          width="44"
          height="32"
          rx="7"
          fill="#fffdf8"
          stroke="#cfcabd"
          strokeWidth="2"
        />
        <circle cx="7" cy="7" r="6" fill="#17213d" />
        <text x="7" y="10" textAnchor="middle" fill="#fff" fontSize="7" fontWeight="800">1</text>
        <rect x="16" y="4" width="11" height="11" rx="2" fill="#111827" stroke="#17213d" strokeWidth="1.5" />
        <path d="M33 7v12m-3-3 3 4 3-4" fill="none" stroke="#1679d2" strokeWidth="2" />
        <rect x="16" y="18" width="11" height="11" rx="2" fill="#fffdf8" stroke="#17213d" strokeWidth="1.5" />
        <circle cx="21.5" cy="23.5" r="2.5" fill="none" stroke="#17213d" strokeWidth="1.4" />
      </g>

      <path d="M160 90v4m-3-2 3 4 3-4" fill="none" stroke="#1679d2" strokeWidth="2" />

      <g transform="translate(138 97)">
        <rect
          width="44"
          height="32"
          rx="7"
          fill="#fffdf8"
          stroke="#cfcabd"
          strokeWidth="2"
        />
        <circle cx="7" cy="7" r="6" fill="#17213d" />
        <text x="7" y="10" textAnchor="middle" fill="#fff" fontSize="7" fontWeight="800">2</text>
        <rect x="16" y="4" width="11" height="11" rx="2" fill="url(#changing-strips-shelf-stripes)" stroke="#17213d" strokeWidth="1.5" />
        <path d="M33 7v12m-3-3 3 4 3-4" fill="none" stroke="#1679d2" strokeWidth="2" />
        <rect x="16" y="18" width="11" height="11" rx="2" fill="#111827" stroke="#17213d" strokeWidth="1.5" />
      </g>

      <g transform="translate(61 133)">
        {RESULT.map((state, index) => (
          <ShelfTile
            state={state}
            x={index * 33}
            y={0}
            key={`result-${index}`}
          />
        ))}
      </g>
    </svg>
  );
}
