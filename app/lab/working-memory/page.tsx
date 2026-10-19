import type { Metadata } from "next";
import { MemoryLabClient } from "./MemoryLabClient";

export const metadata: Metadata = {
  title: "Memory Lab",
  description: "A password-protected space for visual working-memory practice.",
  robots: { index: false, follow: false },
};

export default function WorkingMemoryPage() {
  return <MemoryLabClient />;
}
