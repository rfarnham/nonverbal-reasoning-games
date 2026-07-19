import type {
  GameInfo,
  ShelfIconProps,
} from "@/lib/game-catalog-types";

export const gameInfo = {
  title: "Braids",
  description:
    "Track interwoven ribbons through space and find their true view from the other side.",
  skills: ["Spatial perspective", "Depth tracking"],
  estimatedMinutes: 10,
  shelfOrder: 40,
} satisfies GameInfo;

export function ShelfIcon({ style, ...props }: ShelfIconProps) {
  const crossings = [
    { x: 120, y: 70, vertical: true, color: "#35a999" },
    { x: 196, y: 70, vertical: false, color: "#f3bd4e" },
    { x: 120, y: 116, vertical: false, color: "#7767d7" },
    { x: 196, y: 116, vertical: true, color: "#f06f5f" },
  ] as const;

  return (
    <svg
      {...props}
      viewBox="0 0 320 186"
      style={{ backgroundColor: "#dcefe9", ...style }}
    >
      <rect width="320" height="186" rx="13" fill="#dcefe9" />
      <rect
        x="48"
        y="18"
        width="224"
        height="150"
        rx="17"
        fill="#fffdf8"
        stroke="#17213d"
        strokeWidth="3"
      />
      <path
        d="M54 83h10v20H54"
        fill="none"
        stroke="#17213d"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3"
      />

      <g fill="none" strokeLinecap="round">
        <path d="M120 34v118" stroke="#17213d" strokeWidth="18" />
        <path d="M120 34v118" stroke="#35a999" strokeWidth="13" />
        <path d="M196 34v118" stroke="#17213d" strokeWidth="18" />
        <path d="M196 34v118" stroke="#f06f5f" strokeWidth="13" />
        <path d="M68 70h184" stroke="#17213d" strokeWidth="18" />
        <path d="M68 70h184" stroke="#f3bd4e" strokeWidth="13" />
        <path d="M68 116h184" stroke="#17213d" strokeWidth="18" />
        <path d="M68 116h184" stroke="#7767d7" strokeWidth="13" />

        {crossings.map(({ x, y, vertical, color }) => {
          const path = vertical
            ? `M${x} ${y - 18}v36`
            : `M${x - 18} ${y}h36`;
          return (
            <g key={`${x}-${y}`}>
              <path d={path} stroke="#fffdf8" strokeWidth="25" />
              <path d={path} stroke="#17213d" strokeWidth="18" />
              <path d={path} stroke={color} strokeWidth="13" />
            </g>
          );
        })}
      </g>

      <path
        d="M35 61c-17 13-17 50 2 64"
        fill="none"
        stroke="#17213d"
        strokeLinecap="round"
        strokeWidth="4"
      />
      <path d="m28 122 11 5-2-12Z" fill="#17213d" />
      <path
        d="M285 125c17-13 17-50-2-64"
        fill="none"
        stroke="#17213d"
        strokeLinecap="round"
        strokeWidth="4"
      />
      <path d="m292 64-11-5 2 12Z" fill="#17213d" />
    </svg>
  );
}
