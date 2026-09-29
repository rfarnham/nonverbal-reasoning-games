import type { Metadata } from "next";
import SearchClient from "./SearchClient";

export const metadata: Metadata = {
  title: "Question Search",
  description: "Find related questions by their wording, mathematical structure, and solution approach.",
  robots: { index: false, follow: false },
};

export default function QuestionSearchPage() {
  return <SearchClient />;
}
