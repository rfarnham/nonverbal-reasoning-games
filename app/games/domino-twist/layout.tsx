import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Domino Twist",
  description:
    "Practice spatial composition by finding which pip design cannot be assembled from the given dominoes.",
};

export default function DominoTwistLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
