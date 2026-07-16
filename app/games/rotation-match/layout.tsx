import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Rotation Match",
  description:
    "Practice mental rotation by finding a turned tile pattern among reflections and near-matches.",
};

export default function RotationMatchLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
