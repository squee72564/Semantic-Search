import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { setupServer } from "msw/node";

import { apiHandlers } from "@repo/test-utils";

export const mockApi = setupServer(...apiHandlers);

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

beforeAll(() => mockApi.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  mockApi.resetHandlers();
});
afterAll(() => mockApi.close());
