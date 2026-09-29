import type { Metadata } from "next";
import MathWorldClient from "./MathWorldClient";
import PlaytestGate from "./PlaytestGate";

export const metadata: Metadata = {
  title: "Math Kangaroo Worlds · Playtest",
  description: "Explore sixteen mathematical ideas across thirty-two colorful worlds, with two full-test challenges.",
  robots: { index: false, follow: false },
};

export default function MathWorldPage() {
  return <PlaytestGate><MathWorldClient /></PlaytestGate>;
}
