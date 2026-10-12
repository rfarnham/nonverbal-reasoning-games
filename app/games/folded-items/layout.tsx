import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Folded Items",
  description:
    "Track letters, numbers, and flowers through paper folds to find which items overlap.",
};

export default function FoldedItemsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
