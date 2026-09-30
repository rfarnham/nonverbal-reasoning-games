/** Authored sea encounters. Illustrations are bundled locally; no runtime media service is used. */
export type DangerKind = "squall" | "kraken" | "maelstrom" | "fog" | "icebergs" | "reef";

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
  fog: {
    id: "oceania-danger-fog",
    kicker: "The horizon slips from sight",
    title: "The veiled sea road",
    paragraphs: [
      "Pearl-gray mist spills between the islands. First the distant cliffs disappear; then even the nearest rocks become shadows. This is a fog bank: a cloud resting close to the sea, where a safe channel can be hard to see. With the Tideheart broken, the winds no longer clear the old sea roads as they once did.",
      "Your cyan lantern glows beside the bow as the crew slows the ship. Unfold your voyage notes and look again at ideas that need a little more light. Begin with a familiar puzzle, then try the related puzzles in your packet. Take time to draw and check each step. Together, those small discoveries will help you find a clear passage through the mist.",
    ],
    illustration: {
      src: "/math-world/dangers/fog.webp",
      width: 1536,
      height: 1024,
      alt: "A wooden ship with cream sails and a cyan bow lantern approaches a glowing fog bank that partly hides rocky islands and a distant lighthouse.",
    },
  },
  icebergs: {
    id: "oceania-danger-icebergs",
    kicker: "Blue giants on the move",
    title: "The drifting ice",
    paragraphs: [
      "Great towers of ice shine blue and white above the water. Their hidden roots reach deep below the surface, and the currents slowly carry them across the ship’s path. These are icebergs: pieces of glacier floating out to sea. Since the Tideheart shattered, wandering currents have brought them into this once-open passage.",
      "The crew watches for a wide channel while you open your voyage notes. Revisit a puzzle that was tricky before, then practice the same idea in the related puzzles in your packet. Work carefully on paper and try again whenever you need to. As your understanding grows, you will be ready to guide the ship between the drifting blue giants.",
    ],
    illustration: {
      src: "/math-world/dangers/icebergs.webp",
      width: 1536,
      height: 1024,
      alt: "A small cream-sailed wooden ship approaches a winding polar passage between immense sculpted blue-white icebergs, with submerged ice visible beneath clear water.",
    },
  },
  reef: {
    id: "oceania-danger-reef",
    kicker: "Hidden shapes beneath the glitter",
    title: "The coral shallows",
    paragraphs: [
      "The sea turns clear as glass, revealing gardens of rose, gold, and violet coral. Beautiful as they are, these reefs rise close to the surface, where their hard ridges could catch the bottom of a ship. With the Tideheart gone, shifting currents and unfamiliar tides have made the old route unsafe. A deeper blue channel still winds through the shallows.",
      "Follow that darker ribbon with your eyes, then unfold your voyage notes. A familiar puzzle and its related challenges will help you practice looking closely, testing an idea, and choosing a path. There is no need to hurry: draw, count, and check your work. Each careful discovery brings the crew closer to the open water beyond the reef.",
    ],
    illustration: {
      src: "/math-world/dangers/reef.webp",
      width: 1536,
      height: 1024,
      alt: "A cream-sailed wooden ship follows a deep blue channel through transparent turquoise shallows, with colorful coral, pale sand, and white foam along the reef edges.",
    },
  },
} as const satisfies Record<DangerKind, DangerStoryContent>;
