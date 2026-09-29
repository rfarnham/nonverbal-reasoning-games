import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Subtraction Steps",
  description: "A handwriting subtraction trainer with five adaptive tiers, a writable workspace, and focused review. Progress stays on this device.",
};
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) { return children; }
