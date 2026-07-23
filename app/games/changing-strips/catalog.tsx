import type {
  GameInfo,
  ShelfIconProps,
} from "@/lib/game-catalog-types";
import { progressionMetadata } from "./progression-metadata";

export const gameInfo = {
  title: "Changing Strips",
  description:
    "Follow visual replacement, swap, and neighbor rules in the right order to predict each strip.",
  skills: ["Visual sequencing", "Conditional reasoning"],
  estimatedMinutes: 10,
  progression: progressionMetadata,
  shelfOrder: 45,
} satisfies GameInfo;

const SOURCE = ["solid", "open", "striped", "open", "solid", "striped"] as const;
const RESULT = ["striped", "striped", "open", "striped", "striped", "open"] as const;

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
      ? "#f06f5f"
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
      {state === "solid" ? (
        <circle cx={x + 15} cy={y + 15} r="3.5" fill="#742f36" />
      ) : state === "open" ? (
        <circle
          cx={x + 15}
          cy={y + 15}
          r="5"
          fill="none"
          stroke="#7767d7"
          strokeWidth="2.5"
        />
      ) : (
        <path
          d={`M${x + 10} ${y + 20}l10-10`}
          stroke="#195e5a"
          strokeLinecap="round"
          strokeWidth="3"
        />
      )}
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
          <rect width="8" height="8" fill="#dff4ef" />
          <rect width="4" height="8" fill="#35a999" />
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

      <g aria-hidden="true">
        <circle cx="76" cy="81" r="5" fill="#17213d" />
        <path
          d="M84 81h151"
          fill="none"
          stroke="#17213d"
          strokeLinecap="round"
          strokeWidth="4"
        />
        <path d="m235 73 14 8-14 8Z" fill="#17213d" />
      </g>

      <g transform="translate(104 67)">
        <rect
          width="46"
          height="55"
          rx="9"
          fill="#fffdf8"
          stroke="#cfcabd"
          strokeWidth="2"
        />
        <circle cx="23" cy="14" r="9" fill="#f06f5f" stroke="#17213d" strokeWidth="2" />
        <circle cx="23" cy="14" r="2.5" fill="#742f36" />
        <path d="M23 25v9" stroke="#1679d2" strokeWidth="3" />
        <path d="m18 31 5 6 5-6" fill="none" stroke="#1679d2" strokeWidth="3" />
        <circle cx="23" cy="44" r="9" fill="#fffdf8" stroke="#17213d" strokeWidth="2" />
        <circle cx="23" cy="44" r="3.5" fill="none" stroke="#7767d7" strokeWidth="2" />
      </g>

      <g transform="translate(169 67)">
        <rect
          width="46"
          height="55"
          rx="9"
          fill="#fffdf8"
          stroke="#cfcabd"
          strokeWidth="2"
        />
        <rect
          x="7"
          y="8"
          width="13"
          height="13"
          rx="3"
          fill="url(#changing-strips-shelf-stripes)"
          stroke="#17213d"
          strokeWidth="1.8"
        />
        <rect
          x="26"
          y="34"
          width="13"
          height="13"
          rx="3"
          fill="url(#changing-strips-shelf-stripes)"
          stroke="#17213d"
          strokeWidth="1.8"
        />
        <circle cx="32.5" cy="14.5" r="6.5" fill="#fffdf8" stroke="#17213d" strokeWidth="1.8" />
        <circle cx="32.5" cy="14.5" r="2.4" fill="none" stroke="#7767d7" strokeWidth="1.8" />
        <circle cx="13.5" cy="40.5" r="6.5" fill="#fffdf8" stroke="#17213d" strokeWidth="1.8" />
        <circle cx="13.5" cy="40.5" r="2.4" fill="none" stroke="#7767d7" strokeWidth="1.8" />
        <path d="M16 23c4 9 10 9 14 0M30 31c-4-9-10-9-14 0" fill="none" stroke="#1679d2" strokeWidth="2.3" />
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
