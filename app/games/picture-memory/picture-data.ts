/** Original, bundled picture vocabulary. Variants change a visible object feature,
 * never just its colour, pattern phase, or orientation. */
export const PICTURE_FAMILIES = [
  "apple", "pear", "fish", "bird", "rabbit", "key", "umbrella", "rocket",
  "kite", "balloon", "boat", "leaf", "flower", "teapot", "mug", "boot",
  "guitar", "clock", "shell", "camera", "lantern", "bicycle", "book", "hat",
] as const;

export type PictureFamily = (typeof PICTURE_FAMILIES)[number];
export type PictureVariant = 1 | 2;
export type BasePictureId = `${PictureFamily}-${PictureVariant}`;

/** Only objects with a clear, geometrically certified asymmetric landmark may
 * supply pose traps. Near-symmetric artwork stays upright at every level. */
export const POSE_SAFE_FAMILIES = ["bird", "key", "boat", "teapot", "mug", "boot", "guitar"] as const;
export type PoseSafeFamily = (typeof POSE_SAFE_FAMILIES)[number];
export type PoseSafeBasePictureId = `${PoseSafeFamily}-${PictureVariant}`;

export const PICTURE_POSES = [
  "upright", "turn-90", "turn-180", "turn-270", "mirror-left-right",
  "mirror-top-bottom", "mirror-diagonal", "mirror-antidiagonal",
] as const;
export type PicturePose = (typeof PICTURE_POSES)[number];
export type NonUprightPicturePose = Exclude<PicturePose, "upright">;
export type PictureId = BasePictureId | `${PoseSafeBasePictureId}@${NonUprightPicturePose}`;
export type PictureReflectionAxis = "left-right" | "top-bottom" | "diagonal" | "antidiagonal";

/** Matrices act around the drawing's (60, 60) centre. Row order is xx, xy,
 * yx, yy; applying an outer matrix after an inner one composes actual poses. */
type PoseMatrix = readonly [number, number, number, number];
const POSE_MATRICES: Record<PicturePose, PoseMatrix> = {
  upright: [1, 0, 0, 1],
  "turn-90": [0, -1, 1, 0],
  "turn-180": [-1, 0, 0, -1],
  "turn-270": [0, 1, -1, 0],
  "mirror-left-right": [-1, 0, 0, 1],
  "mirror-top-bottom": [1, 0, 0, -1],
  "mirror-diagonal": [0, 1, 1, 0],
  "mirror-antidiagonal": [0, -1, -1, 0],
};

export const PICTURE_POSE_TRANSFORMS = Object.fromEntries(PICTURE_POSES.map((pose) => {
  const [a, b, c, d] = POSE_MATRICES[pose];
  return [pose, `matrix(${a} ${c} ${b} ${d} ${60 * (1 - a - b)} ${60 * (1 - c - d)})`];
})) as Record<PicturePose, string>;

const POSE_LABELS: Record<PicturePose, string> = {
  upright: "",
  "turn-90": ", turned a quarter turn clockwise",
  "turn-180": ", turned halfway around",
  "turn-270": ", turned a quarter turn counterclockwise",
  "mirror-left-right": ", reflected left to right",
  "mirror-top-bottom": ", reflected top to bottom",
  "mirror-diagonal": ", reflected across the top-left to bottom-right diagonal",
  "mirror-antidiagonal": ", reflected across the top-right to bottom-left diagonal",
};

export type PictureDefinition = {
  readonly id: PictureId;
  readonly baseId: BasePictureId;
  readonly pose: PicturePose;
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

export const UPRIGHT_PICTURES: readonly PictureDefinition[] = PICTURE_FAMILIES.flatMap((family) =>
  ([1, 2] as const).map((variant) => ({
    id: `${family}-${variant}` as BasePictureId,
    baseId: `${family}-${variant}` as BasePictureId,
    pose: "upright" as const,
    family,
    variant,
    label: DESCRIPTIONS[family][variant - 1],
    detail: DESCRIPTIONS[family][variant - 1].toLowerCase(),
  })),
);

export const PICTURES: readonly PictureDefinition[] = [...UPRIGHT_PICTURES, ...UPRIGHT_PICTURES.flatMap((picture) => {
  const poses: readonly PicturePose[] = (POSE_SAFE_FAMILIES as readonly PictureFamily[]).includes(picture.family) ? PICTURE_POSES.filter((pose) => pose !== "upright") : [];
  return poses.map((pose) => ({
    ...picture,
    id: (pose === "upright" ? picture.baseId : `${picture.baseId}@${pose}`) as PictureId,
    pose,
    label: picture.label + POSE_LABELS[pose],
    detail: picture.detail + POSE_LABELS[pose],
  }));
})];

export const PICTURE_IDS: readonly PictureId[] = PICTURES.map(({ id }) => id);
export const BASE_PICTURE_IDS: readonly BasePictureId[] = UPRIGHT_PICTURES.filter(({ variant }) => variant === 1).map(({ baseId }) => baseId);
export const VARIANT_PICTURE_IDS: readonly BasePictureId[] = UPRIGHT_PICTURES.filter(({ variant }) => variant === 2).map(({ baseId }) => baseId);
export const POSE_SAFE_BASE_PICTURE_IDS = UPRIGHT_PICTURES.filter(({ family }) => (POSE_SAFE_FAMILIES as readonly PictureFamily[]).includes(family)).map(({ baseId }) => baseId as PoseSafeBasePictureId);
export const PICTURE_BY_ID = Object.fromEntries(PICTURES.map((picture) => [picture.id, picture])) as Record<PictureId, PictureDefinition>;

export function isPictureId(value: unknown): value is PictureId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PICTURE_BY_ID, value);
}

/** Appearance identity is canonical: upright has its legacy, unsuffixed ID;
 * non-upright poses remain distinct rather than being collapsed to an object. */
export function normalizePictureId(value: string): PictureId {
  if (isPictureId(value)) return value;
  if (value.endsWith("@upright")) {
    const base = value.slice(0, -"@upright".length);
    if (!base.includes("@") && isPictureId(base)) return base;
  }
  throw new RangeError(`Unknown picture appearance: ${value}`);
}

export function pictureBaseId(id: PictureId): BasePictureId {
  return PICTURE_BY_ID[normalizePictureId(id)].baseId;
}

export function picturePose(id: PictureId): PicturePose {
  return PICTURE_BY_ID[normalizePictureId(id)].pose;
}

export function allowedPicturePoses(id: PictureId): readonly PicturePose[] {
  return (POSE_SAFE_FAMILIES as readonly PictureFamily[]).includes(PICTURE_BY_ID[id].family) ? PICTURE_POSES : ["upright"];
}

export function withPicturePose(id: PictureId, pose: PicturePose): PictureId {
  if (!allowedPicturePoses(id).includes(pose)) throw new RangeError(`This object does not support pose traps: ${id}`);
  const base = pictureBaseId(id);
  return normalizePictureId(pose === "upright" ? base : `${base}@${pose}`);
}

export function composePicturePoses(outer: PicturePose, inner: PicturePose): PicturePose {
  const [a, b, c, d] = POSE_MATRICES[outer];
  const [e, f, g, h] = POSE_MATRICES[inner];
  const product = [a * e + b * g, a * f + b * h, c * e + d * g, c * f + d * h];
  const result = PICTURE_POSES.find((pose) => POSE_MATRICES[pose].every((value, index) => value === product[index]));
  if (!result) throw new Error("Picture pose composition left the supported symmetry group.");
  return result;
}

export function rotationTrap(id: PictureId, quarterTurns = 1): PictureId {
  if (!Number.isInteger(quarterTurns) || quarterTurns % 4 === 0) throw new RangeError("A rotation trap needs a nonzero whole quarter turn.");
  const turns = ((quarterTurns % 4) + 4) % 4;
  const rotation: PicturePose = turns === 1 ? "turn-90" : turns === 2 ? "turn-180" : "turn-270";
  return withPicturePose(id, composePicturePoses(rotation, picturePose(id)));
}

export function reflectionTrap(id: PictureId, axis: PictureReflectionAxis = "left-right"): PictureId {
  const reflection = `mirror-${axis}` as PicturePose;
  return withPicturePose(id, composePicturePoses(reflection, picturePose(id)));
}

export function structuralSibling(id: PictureId): PictureId {
  const picture = PICTURE_BY_ID[id];
  const sibling: BasePictureId = `${picture.family}-${picture.variant === 1 ? 2 : 1}`;
  return withPicturePose(sibling, picture.pose);
}

export function transformPicturePoint(point: readonly [number, number], pose: PicturePose): readonly [number, number] {
  const [a, b, c, d] = POSE_MATRICES[pose];
  const x = point[0] - 60;
  const y = point[1] - 60;
  return [60 + a * x + b * y, 60 + c * x + d * y];
}

type PoseAsymmetryWitness = {
  readonly landmark: string;
  readonly kind: "bounds-center" | "circle-center" | "path-start";
  readonly point: readonly [number, number];
  readonly reason: string;
};

const rotateLandmark = ([x, y]: readonly [number, number], degrees: number): readonly [number, number] => {
  const radians = degrees * Math.PI / 180;
  return [60 + (x - 60) * Math.cos(radians) - (y - 60) * Math.sin(radians), 60 + (x - 60) * Math.sin(radians) + (y - 60) * Math.cos(radians)];
};

/** Each named landmark is unique in its authored drawing (tagged in picture.tsx).
 * A symmetry would have to fix that landmark. Its eight transformed positions
 * are pairwise separated by at least 8 drawing units, so none of the seven
 * non-identity D4 operations can preserve the complete drawing or be a no-op.
 * This excludes tiny accidental offsets as a source of apparent uniqueness. */
const FAMILY_POSE_WITNESSES: Record<PoseSafeFamily, PoseAsymmetryWitness> = {
  bird: { landmark: "bird-tail", kind: "bounds-center", point: [32.5, 72.5], reason: "The unique large angular tail is opposite the beak; its bounding-box centre is off all four reflection axes." },
  key: { landmark: "key-hole", kind: "circle-center", point: rotateLandmark([60, 34], -35), reason: "The large enclosed round key hole is off all four reflection axes after the key's authored tilt." },
  boat: { landmark: "boat-sail", kind: "bounds-center", point: [38, 46.5], reason: "The unique large gold triangular sail has an off-axis bounding-box centre." },
  teapot: { landmark: "teapot-spout", kind: "path-start", point: [14, 42], reason: "The spout's outer mouth corner is a unique pointed silhouette feature, distinct from the rounded handle and lid." },
  mug: { landmark: "mug-handle", kind: "bounds-center", point: [95.625, 64.5], reason: "The large side handle's unique cubic loop has this off-axis bounding-box centre." },
  boot: { landmark: "boot-sole", kind: "bounds-center", point: [65.5, 109.5], reason: "The large, solid dark rectangular sole has this off-axis centre, below the right-pointing toe." },
  guitar: { landmark: "guitar-headstock", kind: "bounds-center", point: rotateLandmark([60, 18], 27), reason: "The large teal rectangular headstock has this off-axis centre after the guitar's authored tilt." },
};

export const POSE_ASYMMETRY_WITNESSES = Object.fromEntries(POSE_SAFE_BASE_PICTURE_IDS.map((baseId) => {
  const family = UPRIGHT_PICTURES.find((picture) => picture.baseId === baseId)!.family as PoseSafeFamily;
  return [baseId, FAMILY_POSE_WITNESSES[family]];
})) as Record<PoseSafeBasePictureId, PoseAsymmetryWitness>;

export function pictureHasDistinctPoseOrbit(id: PictureId): boolean {
  const witness = POSE_ASYMMETRY_WITNESSES[pictureBaseId(id) as PoseSafeBasePictureId];
  if (!witness) return false;
  const points = PICTURE_POSES.map((pose) => transformPicturePoint(witness.point, pose));
  return points.every((point, index) => points.slice(index + 1).every((other) => Math.hypot(point[0] - other[0], point[1] - other[1]) >= 8));
}

export function picturePoseOrbit(id: PictureId): readonly PictureId[] {
  return allowedPicturePoses(id).map((pose) => withPicturePose(id, pose));
}
