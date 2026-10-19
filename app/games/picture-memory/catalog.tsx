import type { GameInfo, ShelfIconProps } from "@/lib/game-catalog-types";
import { pictureMemoryGame } from "./game-info";
import { progressionMetadata } from "./progression-metadata";

export const gameInfo = {
  title: pictureMemoryGame.title,
  description: pictureMemoryGame.description,
  skills: pictureMemoryGame.skills,
  estimatedMinutes: pictureMemoryGame.estimatedMinutes,
  progression: progressionMetadata,
  shelfOrder: pictureMemoryGame.shelfOrder,
} satisfies GameInfo;

export function ShelfIcon({ style, ...props }: ShelfIconProps) {
  return (
    <svg
      {...props}
      viewBox="0 0 320 186"
      style={{ backgroundColor: "#f1eadc", ...style }}
    >
      <rect width="320" height="186" rx="13" fill="#f1eadc" />
      <rect x="24" y="27" width="110" height="130" rx="15" fill="#fffdf8" stroke="#cfcabd" strokeWidth="2" />
      <path d="M77 72c-16-15-35-2-28 19 5 18 13 28 28 23 15 5 23-5 28-23 7-21-12-34-28-19Z" fill="#f06f5f" stroke="#17213d" strokeWidth="3" strokeLinejoin="round" />
      <path d="m77 73 2-16m-1 4c9-13 19-10 21-8-4 11-13 12-21 8Z" fill="#35a999" stroke="#17213d" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M63 137h29" stroke="#cfcabd" strokeWidth="4" strokeLinecap="round" />
      <path d="M142 90h17m-6-6 6 6-6 6" fill="none" stroke="#657087" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="170" y="36" width="126" height="114" rx="15" fill="#fffdf8" stroke="#cfcabd" strokeWidth="2" />
      <rect x="180" y="46" width="48" height="44" rx="8" fill="#e3f2e9" stroke="#16836b" strokeWidth="2" />
      <path d="M202 62c-7-7-15-1-12 8 2 8 6 13 12 10 7 3 11-2 13-10 3-9-6-15-13-8Z" fill="#f06f5f" stroke="#17213d" strokeWidth="2" strokeLinejoin="round" />
      <path d="m202 62 1-8m0 3 6-2" fill="none" stroke="#17213d" strokeWidth="2" strokeLinecap="round" />
      <path d="m218 45 5 5 9-11" fill="none" stroke="#16836b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="251" cy="62" r="8" fill="#f3bd4e" stroke="#17213d" strokeWidth="2" />
      <path d="m257 67 15 14m-6-5 4-4m-8 0 4-4" fill="none" stroke="#17213d" strokeWidth="4" strokeLinecap="round" />
      <path d="M190 115q15-19 28 0-13 19-28 0Zm28 0 8-8v16Z" fill="#35a999" stroke="#17213d" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="198" cy="113" r="2" fill="#17213d" />
      <path d="M246 103h22v22q-11 10-22 0Zm22 4h4q10 7-4 13" fill="#7767d7" stroke="#17213d" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
