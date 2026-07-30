import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Borrow Flash",
  description:
    "Quick visual and listening practice for subtraction facts that cross ten.",
};

export default function SubtractionFlashLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
