import type {
  GameInfo,
  ShelfIconProps,
} from "@/lib/game-catalog-types";

export const gameInfo = {
  title: "Transformation Match",
  description:
    "Apply a rotation or reflection and find the exact transformed pattern.",
  skills: ["Mental transformation", "Visual comparison"],
  estimatedMinutes: 10,
  shelfOrder: 10,
  featured: true,
} satisfies GameInfo;

export function ShelfIcon({ style, ...props }: ShelfIconProps) {
  return (
    <svg
      {...props}
      viewBox="0 0 320 186"
      style={{ backgroundColor: "#dce8f8", ...style }}
    >
      <rect width="320" height="186" rx="13" fill="#dce8f8" />
      <g fill="#6594e3">
        <rect x="54" y="34" width="52" height="52" rx="10" />
        <rect x="86" y="66" width="52" height="52" rx="10" />
        <rect x="54" y="98" width="52" height="52" rx="10" />
      </g>
      <g fill="#f06f5f">
        <rect x="202" y="36" width="52" height="52" rx="10" />
        <rect x="170" y="68" width="52" height="52" rx="10" />
        <rect x="202" y="100" width="52" height="52" rx="10" />
      </g>
      <path
        d="M211 23a35 35 0 0 1 43 18"
        fill="none"
        stroke="#17213d"
        strokeLinecap="round"
        strokeWidth="5"
      />
      <path d="m258 33 1 16-15-6Z" fill="#17213d" />
    </svg>
  );
}
