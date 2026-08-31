import { describe, expect, it } from "vitest";

import { runPollingLoop } from "./worker.js";

describe("runPollingLoop", () => {
  it("polls until cancellation is requested", async () => {
    const abortController = new AbortController();
    let polls = 0;

    await runPollingLoop({
      poll: () => {
        polls += 1;
        abortController.abort();
        return Promise.resolve();
      },
      pollIntervalMs: 100,
      signal: abortController.signal,
    });

    expect(polls).toBe(1);
  });

  it("propagates polling failures", async () => {
    const error = new Error("poll failed");

    await expect(
      runPollingLoop({
        poll: () => Promise.reject(error),
        pollIntervalMs: 100,
        signal: new AbortController().signal,
      }),
    ).rejects.toBe(error);
  });
});
