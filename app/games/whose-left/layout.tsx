import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Whose Left?",
  description:
    "Practice spatial perspective by tracking who falls to a walker's left or right as a path turns.",
};

export default function WhoseLeftLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
