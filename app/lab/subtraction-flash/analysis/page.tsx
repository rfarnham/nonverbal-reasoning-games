import type { Metadata } from "next";

import { PerformanceAnalysisClient } from "./performance-analysis-client";

export const metadata: Metadata = {
  title: "Performance · Borrow Flash",
  description: "Explore device-local Subtraction Flash practice results.",
};

export default function SubtractionFlashPerformancePage() {
  return <PerformanceAnalysisClient />;
}
