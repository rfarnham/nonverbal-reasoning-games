import Image from "next/image";
import type { CSSProperties, HTMLAttributes } from "react";
import styles from "./avatar.module.css";

export const AVATAR_OPTIONS = [
  {
    id: "hedgehog",
    name: "Hedgehog",
    asset: "/avatars/hedgehog.svg",
    accent: "gold",
  },
  {
    id: "fox",
    name: "Fox",
    asset: "/avatars/fox.svg",
    accent: "coral",
  },
  {
    id: "rabbit",
    name: "Rabbit",
    asset: "/avatars/rabbit.svg",
    accent: "violet",
  },
  {
    id: "panda",
    name: "Panda",
    asset: "/avatars/panda.svg",
    accent: "blue",
  },
  {
    id: "owl",
    name: "Owl",
    asset: "/avatars/owl.svg",
    accent: "teal",
  },
  {
    id: "penguin",
    name: "Penguin",
    asset: "/avatars/penguin.svg",
    accent: "blue",
  },
  {
    id: "frog",
    name: "Frog",
    asset: "/avatars/frog.svg",
    accent: "lime",
  },
  {
    id: "monkey",
    name: "Monkey",
    asset: "/avatars/monkey.svg",
    accent: "coral",
  },
  {
    id: "lion",
    name: "Lion",
    asset: "/avatars/lion.svg",
    accent: "gold",
  },
  {
    id: "elephant",
    name: "Elephant",
    asset: "/avatars/elephant.svg",
    accent: "violet",
  },
  {
    id: "turtle",
    name: "Turtle",
    asset: "/avatars/turtle.svg",
    accent: "teal",
  },
  {
    id: "unicorn",
    name: "Unicorn",
    asset: "/avatars/unicorn.svg",
    accent: "coral",
  },
] as const;

export type AvatarId = (typeof AVATAR_OPTIONS)[number]["id"];
export type AvatarState = "idle" | "walking" | "celebrating" | "level-up";
export type AvatarSize = "small" | "medium" | "large" | "hero";

type AvatarOption = (typeof AVATAR_OPTIONS)[number];

const AVATAR_SIZES: Record<AvatarSize, number> = {
  small: 48,
  medium: 72,
  large: 112,
  hero: 160,
};

const AVATAR_BY_ID = new Map<AvatarId, AvatarOption>(
  AVATAR_OPTIONS.map((option) => [option.id, option]),
);

const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");

export const DEFAULT_AVATAR_ID: AvatarId = "hedgehog";

export function isAvatarId(value: unknown): value is AvatarId {
  return (
    typeof value === "string" &&
    AVATAR_BY_ID.has(value as AvatarId)
  );
}

export function getAvatarOption(id: AvatarId): AvatarOption {
  return AVATAR_BY_ID.get(id) ?? AVATAR_BY_ID.get(DEFAULT_AVATAR_ID)!;
}

export function getAvatarAssetPath(id: AvatarId): string {
  return `${basePath}${getAvatarOption(id).asset}`;
}

export interface AvatarProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  avatar: AvatarId;
  size?: AvatarSize | number;
  state?: AvatarState;
  decorative?: boolean;
  label?: string;
  eager?: boolean;
}

export function Avatar({
  avatar,
  size = "medium",
  state = "idle",
  decorative = false,
  label,
  eager = false,
  className,
  style,
  ...props
}: Readonly<AvatarProps>) {
  const option = getAvatarOption(avatar);
  const pixels =
    typeof size === "number" ? Math.max(32, size) : AVATAR_SIZES[size];
  const avatarStyle = {
    ...style,
    "--avatar-size": `${pixels}px`,
  } as CSSProperties;

  return (
    <span
      {...props}
      className={[styles.avatar, className].filter(Boolean).join(" ")}
      style={avatarStyle}
      data-accent={option.accent}
      data-state={state}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : (label ?? `${option.name} avatar`)}
      aria-hidden={decorative || undefined}
    >
      <span className={styles.shadow} aria-hidden="true" />
      <span className={styles.motion} aria-hidden="true">
        <Image
          className={styles.image}
          src={getAvatarAssetPath(option.id)}
          alt=""
          width={32}
          height={32}
          draggable={false}
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : undefined}
          unoptimized
        />
      </span>
    </span>
  );
}
