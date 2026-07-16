import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Transformation Match",
  description:
    "Practice mental transformations by finding the exact rotation or reflection among near-matches.",
};

export default function RotationMatchLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
