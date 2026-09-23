import type { Metadata } from "next";
import MathWorldClient from "./MathWorldClient";
import PlaytestGate from "./PlaytestGate";

export const metadata: Metadata = {
  title: "Math Kangaroo Worlds · Playtest",
  description: "Explore a spiral of mathematical ideas across twenty colorful worlds.",
  robots: { index: false, follow: false },
};

export default function MathWorldPage() {
  return <PlaytestGate><MathWorldClient /></PlaytestGate>;
}
