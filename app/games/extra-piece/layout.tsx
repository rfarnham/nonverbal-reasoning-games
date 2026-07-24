import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Extra Piece",
  description:
    "Practice spatial composition, mental rotation, and chirality by finding the piece that cannot tile the square.",
};

export default function ExtraPieceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
