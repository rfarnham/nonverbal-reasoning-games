import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pattern Matrix",
  description:
    "Practice visual rule finding by choosing the one piece that completes each pattern matrix.",
  alternates: {
    canonical:
      "https://rfarnham.github.io/nonverbal-reasoning-games/games/pattern-matrix/",
  },
};

export default function PatternMatrixLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
