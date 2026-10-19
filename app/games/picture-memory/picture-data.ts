/** Original, bundled picture vocabulary. Variants change a visible object feature,
 * never just its colour, pattern phase, or orientation. */
export const PICTURE_FAMILIES = [
  "apple", "pear", "fish", "bird", "rabbit", "key", "umbrella", "rocket",
  "kite", "balloon", "boat", "leaf", "flower", "teapot", "mug", "boot",
  "guitar", "clock", "shell", "camera", "lantern", "bicycle", "book", "hat",
] as const;

export type PictureFamily = (typeof PICTURE_FAMILIES)[number];
export type PictureVariant = 1 | 2;
export type PictureId = `${PictureFamily}-${PictureVariant}`;

export type PictureDefinition = {
  readonly id: PictureId;
  readonly family: PictureFamily;
  readonly variant: PictureVariant;
  readonly label: string;
  readonly detail: string;
};

const DESCRIPTIONS: Record<PictureFamily, readonly [string, string]> = {
  apple: ["Whole apple", "Apple with a bite"],
  pear: ["One pear", "Two pears"],
  fish: ["Fish with a round tail", "Fish with a forked tail"],
  bird: ["Bird with folded wings", "Bird with raised wings"],
  rabbit: ["Rabbit with upright ears", "Rabbit with sideways ears"],
  key: ["Key with one tooth", "Key with two teeth"],
  umbrella: ["Open umbrella", "Closed umbrella"],
  rocket: ["Rocket without boosters", "Rocket with two boosters"],
  kite: ["Diamond kite", "Triangular kite"],
  balloon: ["One balloon", "Three balloons"],
  boat: ["Boat with one sail", "Boat with two sails"],
  leaf: ["Smooth leaf", "Lobed leaf"],
  flower: ["Round-petal flower", "Tulip"],
  teapot: ["Round teapot", "Tall teapot"],
  mug: ["Mug without a spoon", "Mug with a spoon"],
  boot: ["Short boot", "Tall boot"],
  guitar: ["Acoustic guitar", "Electric guitar"],
  clock: ["Round clock", "Square clock"],
  shell: ["Fan shell", "Spiral shell"],
  camera: ["Camera without a flash", "Camera with a raised flash"],
  lantern: ["Square lantern", "Round lantern"],
  bicycle: ["Bicycle without a basket", "Bicycle with a basket"],
  book: ["Closed book", "Open book"],
  hat: ["Brimmed hat", "Peaked cap"],
};

export const PICTURES: readonly PictureDefinition[] = PICTURE_FAMILIES.flatMap((family) =>
  ([1, 2] as const).map((variant) => ({
    id: `${family}-${variant}` as PictureId,
    family,
    variant,
    label: DESCRIPTIONS[family][variant - 1],
    detail: DESCRIPTIONS[family][variant - 1].toLowerCase(),
  })),
);

export const PICTURE_IDS: readonly PictureId[] = PICTURES.map(({ id }) => id);
export const BASE_PICTURE_IDS: readonly PictureId[] = PICTURES.filter(({ variant }) => variant === 1).map(({ id }) => id);
export const VARIANT_PICTURE_IDS: readonly PictureId[] = PICTURES.filter(({ variant }) => variant === 2).map(({ id }) => id);
export const PICTURE_BY_ID = Object.fromEntries(PICTURES.map((picture) => [picture.id, picture])) as Record<PictureId, PictureDefinition>;
