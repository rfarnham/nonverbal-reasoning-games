/** Authored sea encounters. Illustrations are bundled locally; no runtime media service is used. */
export type DangerKind = "squall" | "kraken" | "maelstrom";

export type DangerStoryContent = {
  id: string;
  kicker: string;
  title: string;
  paragraphs: readonly [string, string];
  illustration: {
    src: string;
    width: number;
    height: number;
    alt: string;
  };
};

export const DANGER_STORIES = {
  squall: {
    id: "oceania-danger-squall",
    kicker: "A dark cloud on the sea road",
    title: "The sudden squall",
    paragraphs: [
      "A dark cloud rolls across the sea. Wind whistles through the ropes, rain streaks the water, and lightning flickers beneath its silver edges. This is a squall: a small, fierce burst of storm, far smaller than a hurricane. With the Tideheart broken, even a sunny passage can hold a surprise.",
      "Your blue lantern shines through the spray. Open your voyage notes and return to a few puzzles that need another look. Start with one you remember, then try some that use the same idea. There is time to think, draw, and try again. Each idea you strengthen helps guide the ship toward the clear water beyond.",
    ],
    illustration: {
      src: "/math-world/dangers/squall.webp",
      width: 1536,
      height: 1024,
      alt: "A cream-sailed wooden ship approaches a dark squall, with curling wind, rain, and lightning beneath the cloud and sunlight beyond.",
    },
  },
  kraken: {
    id: "oceania-danger-kraken",
    kicker: "Something stirs beneath the waves",
    title: "Arms from the deep",
    paragraphs: [
      "A long purple arm rises from the water. Then another curls beside the ship, lined with pale round suckers. A kraken has awakened: a giant of the deep, strong enough to wrap its arms around a whole vessel. Since the Tideheart fell silent, these mysterious creatures have begun exploring the old sea roads.",
      "Keep your lantern bright and your thoughts steady. Your voyage notes hold puzzles worth visiting again, followed by new puzzles with familiar ideas inside them. Work through each one on paper, one careful step at a time. As those ideas become clearer, you and your crew can chart a passage beyond the kraken’s reaching arms.",
    ],
    illustration: {
      src: "/math-world/dangers/kraken.webp",
      width: 1536,
      height: 1024,
      alt: "An enormous violet and teal kraken raises curling, sucker-lined arms beside a small wooden sailing ship on a sunlit ocean.",
    },
  },
  maelstrom: {
    id: "oceania-danger-maelstrom",
    kicker: "The sea begins to turn",
    title: "The whirling water",
    paragraphs: [
      "White ribbons of foam circle the ship. They sweep inward, down and down, into a deep blue hollow. This is a maelstrom: a great whirlpool whose turning currents can pull a vessel toward its center. The Tideheart once kept these wild currents in balance. Now the sea has begun to twist again.",
      "Your ship rides the outer edge while you unfold your voyage notes. Look again at a puzzle that was tricky before, then explore a few more built around the same idea. Draw, count, compare, and take the time you need. Piece by piece, your growing understanding will help you find the current that leads back to open sea.",
    ],
    illustration: {
      src: "/math-world/dangers/maelstrom.webp",
      width: 1536,
      height: 1024,
      alt: "A wooden sailing ship rides the outer rim of a vast turquoise whirlpool, with white foam spiraling down into a deep blue center.",
    },
  },
} as const satisfies Record<DangerKind, DangerStoryContent>;
