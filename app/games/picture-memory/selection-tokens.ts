/** Save a selection by option position, independent of the order it was tapped. */
export function encodeSelectionAnswerToken<PictureId extends string>(
  selected: readonly PictureId[],
  options: readonly PictureId[],
): string {
  if (new Set(options).size !== options.length) {
    throw new Error("Answer options must be distinct.");
  }
  if (new Set(selected).size !== selected.length) {
    throw new Error("A picture cannot be selected twice.");
  }
  const indices = selected.map((picture) => options.indexOf(picture));
  if (indices.some((index) => index < 0)) {
    throw new Error("A selected picture is not an answer option.");
  }
  return `selection:${indices.sort((left, right) => left - right).join(",")}`;
}

/** Invalid or stale tokens never restore an invented or repeated picture. */
export function decodeSelectionFromAnswerToken<PictureId extends string>(
  token: string | null | undefined,
  options: readonly PictureId[],
): readonly PictureId[] | null {
  if (
    typeof token !== "string" ||
    !/^selection:(?:(?:0|[1-9][0-9]*)(?:,(?:0|[1-9][0-9]*))*)?$/.test(token) ||
    new Set(options).size !== options.length
  ) {
    return null;
  }
  const body = token.slice("selection:".length);
  if (!body) return [];
  const indices = body.split(",").map(Number);
  if (
    indices.some((index) => !Number.isSafeInteger(index) || index >= options.length) ||
    new Set(indices).size !== indices.length
  ) {
    return null;
  }
  return indices.sort((left, right) => left - right).map((index) => options[index]);
}
