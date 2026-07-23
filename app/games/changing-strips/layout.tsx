import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Changing Strips",
  description:
    "Practice following visual replacement, swap, and neighbor rules in the right order.",
};

export default function ChangingStripsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
