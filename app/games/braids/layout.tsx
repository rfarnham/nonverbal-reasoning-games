import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Braids",
  description:
    "Practice spatial perspective by finding the true opposite-side view of interwoven ribbons.",
};

export default function BraidsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
