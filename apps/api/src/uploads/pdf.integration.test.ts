import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createPdfValidator } from "./pdf.js";
const fixture = (name: string) =>
  fileURLToPath(new URL(`../../test/fixtures/${name}.pdf`, import.meta.url));

describe.runIf(process.env.PDF_VALIDATION_INTEGRATION_TESTS === "true")(
  "real Poppler PDF validation",
  () => {
    const validate = createPdfValidator({ executable: process.env.PDFINFO_PATH ?? "pdfinfo" });
    it("accepts a readable PDF", async () => {
      await expect(
        validate(fixture("readable"), new AbortController().signal),
      ).resolves.toBeUndefined();
    });
    it.each(["encrypted", "encrypted-empty-password", "malformed", "truncated"])(
      "rejects %s PDFs",
      async (name) => {
        await expect(validate(fixture(name), new AbortController().signal)).rejects.toMatchObject({
          status: 422,
          code: "INVALID_PDF",
        });
      },
    );
  },
);
