import type { Metadata, Viewport } from "next";
import "./globals.css";

const projectUrl = "https://rfarnham.github.io/nonverbal-reasoning-games/";
const previewUrl = `${projectUrl}og.png`;

export const metadata: Metadata = {
  metadataBase: new URL(projectUrl),
  title: {
    default: "Spatial Gym — Nonverbal Reasoning Games",
    template: "%s · Spatial Gym",
  },
  description:
    "Free browser games for practicing mental rotation, pattern spotting, spatial memory, and visual logic.",
  applicationName: "Spatial Gym",
  alternates: {
    canonical: projectUrl,
  },
  icons: {
    icon: `${projectUrl}favicon.svg`,
  },
  openGraph: {
    type: "website",
    url: projectUrl,
    siteName: "Spatial Gym",
    title: "Spatial Gym — Train how you see",
    description:
      "Short, focused browser games for nonverbal visual-spatial reasoning.",
    images: [
      {
        url: previewUrl,
        width: 1536,
        height: 1024,
        alt: "Spatial Gym visual-spatial reasoning games",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Spatial Gym — Train how you see",
    description:
      "Short, focused browser games for nonverbal visual-spatial reasoning.",
    images: [previewUrl],
  },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f4f0e6",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
