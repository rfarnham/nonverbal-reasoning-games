import type { Metadata } from "next";
import MathWorldClient from "./MathWorldClient";

export const metadata: Metadata = {
  title: "Counting Coast · Math Kangaroo Worlds",
  description: "A polished map adventure built around Math Kangaroo questions.",
};

export default function MathWorldPage() {
  return <MathWorldClient />;
}
