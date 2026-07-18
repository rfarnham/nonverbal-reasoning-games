import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Libra",
  description:
    "Practice visual equivalence and relational reasoning with balanced animal scales.",
};

export default function LibraLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
