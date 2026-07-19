import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shape Fold",
  description:
    "Practice spatial folding by predicting where punched openings land when folded paper is opened.",
};

export default function ShapeFoldLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
