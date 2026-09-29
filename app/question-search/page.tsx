import type { Metadata } from "next";
import SearchClient from "./SearchClient";

export const metadata: Metadata = {
  title: "Question Search",
  description: "Find related questions by their wording, mathematical structure, and solution approach.",
  robots: { index: false, follow: false },
  icons: { icon: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/favicon.svg` },
};

export default function QuestionSearchPage() {
  return <SearchClient />;
}
