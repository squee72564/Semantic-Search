import { describe, expect, it } from "vitest";

import { createCursorPage } from "./pagination.js";

describe("Cursor pagination", () => {
  it("returns a cursor from the last visible item when an overfetched row exists", () => {
    const page = createCursorPage(
      [
        { id: "3", rank: 30 },
        { id: "2", rank: 20 },
        { id: "1", rank: 10 },
      ],
      2,
      ({ id, rank }) => ({ id, rank }),
    );

    expect(page).toEqual({
      items: [
        { id: "3", rank: 30 },
        { id: "2", rank: 20 },
      ],
      nextCursor: { id: "2", rank: 20 },
    });
  });

  it("returns no cursor for a final or empty page", () => {
    expect(createCursorPage([{ id: "1" }], 2, ({ id }) => id)).toEqual({
      items: [{ id: "1" }],
      nextCursor: null,
    });
    expect(createCursorPage([], 2, ({ id }: { id: string }) => id)).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("rejects invalid limits", () => {
    expect(() => createCursorPage([], 0, String)).toThrow(
      "Pagination limit must be a positive safe integer",
    );
    expect(() => createCursorPage([], 1.5, String)).toThrow(
      "Pagination limit must be a positive safe integer",
    );
  });
});
