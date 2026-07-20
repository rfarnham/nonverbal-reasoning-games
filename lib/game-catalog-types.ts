import type { ComponentType, SVGProps } from "react";

export type ShelfIconProps = SVGProps<SVGSVGElement>;

export type GameInfo = {
  title: string;
  description: string;
  skills: readonly string[];
  estimatedMinutes: number;
  progression: {
    contentVersion: string;
    generatorVersion: string;
  };
  shelfOrder?: number;
  featured?: boolean;
};

export type GameCatalogEntry = GameInfo & {
  slug: string;
  href: `/games/${string}/`;
  ShelfIcon: ComponentType<ShelfIconProps>;
};
