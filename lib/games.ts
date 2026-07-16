export type GameStatus = "live" | "planned";

export type GameDefinition = {
  slug: string;
  title: string;
  description: string;
  skills: readonly string[];
  status: GameStatus;
};

export const games: readonly GameDefinition[] = [
  {
    slug: "rotation-match",
    title: "Transformation Match",
    description:
      "Apply a rotation or reflection and find the exact transformed pattern.",
    skills: ["Mental transformation", "Visual comparison"],
    status: "live",
  },
  {
    slug: "pattern-matrix",
    title: "Pattern Matrix",
    description:
      "Complete a visual matrix by discovering the rule across rows and columns.",
    skills: ["Rule finding", "Pattern completion"],
    status: "planned",
  },
  {
    slug: "shape-fold",
    title: "Shape Fold",
    description:
      "Predict where marks and cut-outs land when a flat shape is folded and opened.",
    skills: ["Spatial folding", "Working memory"],
    status: "planned",
  },
] as const;
