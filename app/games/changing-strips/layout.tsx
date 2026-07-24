import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Changing Strips",
  description:
    "Practice applying clear black-and-white pattern changes in numbered order.",
};

export default function ChangingStripsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
