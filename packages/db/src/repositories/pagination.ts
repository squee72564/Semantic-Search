export interface CursorPage<TItem, TCursor> {
  items: TItem[];
  nextCursor: TCursor | null;
}

export function createCursorPage<TItem, TCursor>(
  rows: readonly TItem[],
  limit: number,
  cursorFor: (item: TItem) => TCursor,
): CursorPage<TItem, TCursor> {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError("Pagination limit must be a positive safe integer");
  }

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : [...rows];
  const lastItem = items.at(-1);

  return {
    items,
    nextCursor: hasMore && lastItem !== undefined ? cursorFor(lastItem) : null,
  };
}
