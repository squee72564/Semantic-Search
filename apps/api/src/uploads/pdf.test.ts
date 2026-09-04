import { execFile, ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createPdfValidator } from "./pdf.js";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFile: vi.fn<typeof execFile>(),
}));
const fixture = fileURLToPath(new URL("../../test/fixtures/readable.pdf", import.meta.url));

function mockResult(error: Error | null, stdout = "Pages: 1\nEncrypted: no\n", stderr = "") {
  vi.mocked(execFile).mockImplementation((...args) => {
    const callback = args.at(-1);
    if (typeof callback !== "function") throw new Error("execFile requires a completion callback");
    callback(error, stdout, stderr);
    return new ChildProcess();
  });
}

describe("PDF validation process boundary", () => {
  it("uses an argument array, disabled shell, timeout, and bounded output", async () => {
    mockResult(null);
    await createPdfValidator({ executable: "pdfinfo", timeoutMs: 50 })(
      fixture,
      new AbortController().signal,
    );
    expect(execFile).toHaveBeenCalledWith(
      "pdfinfo",
      [fixture],
      expect.objectContaining({ shell: false, windowsHide: true, timeout: 50, maxBuffer: 65536 }),
      expect.any(Function),
    );
  });
  it("maps a process timeout to a validation failure", async () => {
    mockResult(Object.assign(new Error("killed"), { killed: true }));
    await expect(createPdfValidator()(fixture, new AbortController().signal)).rejects.toMatchObject(
      { status: 422 },
    );
  });
  it("reports missing Poppler as an operational failure", async () => {
    mockResult(Object.assign(new Error("missing"), { code: "ENOENT" }));
    await expect(createPdfValidator()(fixture, new AbortController().signal)).rejects.toMatchObject(
      { status: 503 },
    );
  });
  it.each(["Pages: 1\nEncrypted: yes\n", "Pages: 0\nEncrypted: no\n", "unrecognized output"])(
    "rejects invalid validation output %s",
    async (stdout) => {
      mockResult(null, stdout);
      await expect(
        createPdfValidator()(fixture, new AbortController().signal),
      ).rejects.toMatchObject({ status: 422 });
    },
  );
  it("rejects parser errors even when pdfinfo exits successfully", async () => {
    mockResult(null, "Pages: 1\nEncrypted: no\n", "Syntax Error: damaged xref");
    await expect(createPdfValidator()(fixture, new AbortController().signal)).rejects.toMatchObject(
      { status: 422 },
    );
  });
  it("does not start the validator for an aborted request", async () => {
    await expect(createPdfValidator()(fixture, AbortSignal.abort())).rejects.toMatchObject({
      status: 408,
    });
    expect(execFile).not.toHaveBeenCalled();
  });
});
