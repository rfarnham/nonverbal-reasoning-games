import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Picture Memory",
  description:
    "Study everyday objects, hide the pictures, and recognize the objects you remember in an untimed visual memory game.",
};

export default function PictureMemoryLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
