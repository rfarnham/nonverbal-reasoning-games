import type {
  GameInfo,
  ShelfIconProps,
} from "@/lib/game-catalog-types";

export const gameInfo = {
  title: "Whose Left?",
  description:
    "Follow a turning path and keep left and right anchored to the walker, not the page.",
  skills: ["Spatial perspective", "Direction tracking"],
  estimatedMinutes: 10,
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
        d="M58 104h130V42h-82"
        fill="none"
        stroke="#17213d"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="9"
      />
      <path d="m183 60 19-18-19-18Z" fill="#17213d" />
      <circle cx="58" cy="104" r="17" fill="#17213d" />
      <text
        x="58"
        y="110"
        fill="#fffdf8"
        fontFamily="ui-monospace, monospace"
        fontSize="15"
        fontWeight="900"
        textAnchor="middle"
      >
        S
      </text>
      <circle
        cx="106"
        cy="42"
        r="17"
        fill="#fffdf8"
        stroke="#17213d"
        strokeWidth="3"
      />
      <text
        x="106"
        y="48"
        fill="#17213d"
        fontFamily="ui-monospace, monospace"
        fontSize="15"
        fontWeight="900"
        textAnchor="middle"
      >
        F
      </text>
      <g stroke="#17213d" strokeWidth="3">
        <circle cx="119" cy="133" r="19" fill="#f06f5f" />
        <circle cx="226" cy="72" r="19" fill="#35a999" />
      </g>
      <g
        fill="#17213d"
        fontFamily="Inter, sans-serif"
        fontSize="16"
        fontWeight="900"
        textAnchor="middle"
      >
        <text x="119" y="139">A</text>
        <text x="226" y="78">B</text>
      </g>
      <path
        d="M159 91h22m-8-8 8 8-8 8"
        fill="none"
        stroke="#fffdf8"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="4"
      />
    </svg>
  );
}
