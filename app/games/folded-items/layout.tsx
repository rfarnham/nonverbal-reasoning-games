import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Folded Items",
  description:
    "Track letters, numbers, and shapes through paper folds, from matching partners to ordered stacks.",
};

export default function FoldedItemsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
