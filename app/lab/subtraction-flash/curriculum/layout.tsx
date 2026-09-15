import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Grade 1 Arithmetic | Borrow Flash",
  description:
    "A complete Grade 1 arithmetic-fluency curriculum with skill-by-skill practice.",
};

export default function ArithmeticCurriculumLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
