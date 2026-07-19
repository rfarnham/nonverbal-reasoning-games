import type {
  GameInfo,
  ShelfIconProps,
} from "@/lib/game-catalog-types";

export const gameInfo = {
  title: "Domino Twist",
  description:
    "Turn fixed domino pairs in your mind and spot the pip design they cannot build.",
  skills: ["Spatial composition", "Part-whole reasoning"],
  estimatedMinutes: 10,
  shelfOrder: 40,
} satisfies GameInfo;

export function ShelfIcon({ style, ...props }: ShelfIconProps) {
  return (
    <svg
      {...props}
      viewBox="0 0 320 186"
      style={{ backgroundColor: "#e7e0f4", ...style }}
    >
      <rect width="320" height="186" rx="13" fill="#e7e0f4" />

      <g stroke="#17213d" strokeWidth="3">
        <g transform="rotate(-8 71 53)">
          <rect
            x="30"
            y="35"
            width="82"
            height="36"
            rx="9"
            fill="#f06f5f"
          />
          <path d="M71 35v36" />
          <circle cx="50" cy="53" r="4" fill="#17213d" stroke="none" />
          <circle cx="87" cy="45" r="4" fill="#17213d" stroke="none" />
          <circle cx="96" cy="61" r="4" fill="#17213d" stroke="none" />
        </g>

        <g transform="rotate(16 91 103)">
          <rect
            x="50"
            y="85"
            width="82"
            height="36"
            rx="9"
            fill="#35a999"
          />
          <path d="M91 85v36" />
          <circle cx="70" cy="95" r="4" fill="#17213d" stroke="none" />
          <circle cx="70" cy="111" r="4" fill="#17213d" stroke="none" />
          <circle cx="112" cy="103" r="4" fill="#17213d" stroke="none" />
        </g>

        <g transform="rotate(-11 137 133)">
          <rect
            x="119"
            y="92"
            width="36"
            height="82"
            rx="9"
            fill="#7767d7"
          />
          <path d="M119 133h36" />
          <circle cx="137" cy="112" r="4" fill="#17213d" stroke="none" />
          <circle cx="129" cy="147" r="4" fill="#17213d" stroke="none" />
          <circle cx="145" cy="147" r="4" fill="#17213d" stroke="none" />
          <circle cx="137" cy="160" r="4" fill="#17213d" stroke="none" />
        </g>
      </g>

      <path
        d="M151 57c19-15 35-9 42 8"
        fill="none"
        stroke="#17213d"
        strokeLinecap="round"
        strokeWidth="5"
      />
      <path d="m194 56 5 17-17-5Z" fill="#17213d" />

      <g stroke="#17213d" strokeWidth="3">
        <rect
          x="205"
          y="57"
          width="36"
          height="72"
          rx="9"
          fill="#f06f5f"
        />
        <path d="M205 93h36" />
        <rect
          x="241"
          y="57"
          width="72"
          height="36"
          rx="9"
          fill="#35a999"
        />
        <path d="M277 57v36" />
        <rect
          x="241"
          y="93"
          width="72"
          height="36"
          rx="9"
          fill="#7767d7"
        />
        <path d="M277 93v36" />

        <g fill="#17213d" stroke="none">
          <circle cx="223" cy="75" r="4" />
          <circle cx="215" cy="105" r="4" />
          <circle cx="231" cy="117" r="4" />

          <circle cx="259" cy="67" r="4" />
          <circle cx="259" cy="83" r="4" />
          <circle cx="295" cy="75" r="4" />

          <circle cx="259" cy="111" r="4" />
          <circle cx="287" cy="103" r="4" />
          <circle cx="303" cy="103" r="4" />
          <circle cx="287" cy="119" r="4" />
          <circle cx="303" cy="119" r="4" />
        </g>
      </g>
    </svg>
  );
}
