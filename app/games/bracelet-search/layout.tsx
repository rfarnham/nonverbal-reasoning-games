import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bracelet Search",
  description:
    "Practice visual sequence search by spotting the one bead run hidden around a circular bracelet.",
};

export default function BraceletSearchLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
