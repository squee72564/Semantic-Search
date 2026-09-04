import { execFile } from "node:child_process";
import { open } from "node:fs/promises";
import { throwIfUploadAborted, uploadError } from "./errors.js";

export type ValidatePdf = (path: string, signal: AbortSignal) => Promise<void>;

export function createPdfValidator({
  executable = "pdfinfo",
  timeoutMs = 30_000,
}: {
  executable?: string;
  timeoutMs?: number;
} = {}): ValidatePdf {
  return async (path, signal) => {
    throwIfUploadAborted(signal);
    const file = await open(path, "r");
    try {
      const signature = Buffer.alloc(5);
      const { bytesRead } = await file.read(signature, 0, signature.length, 0);
      if (bytesRead !== 5 || signature.toString("ascii") !== "%PDF-") {
        throw uploadError(422, "INVALID_PDF", "The file must be a readable PDF.");
      }
    } finally {
      await file.close();
    }
    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        executable,
        [path],
        {
          shell: false,
          windowsHide: true,
          timeout: timeoutMs,
          maxBuffer: 64 * 1024,
          encoding: "utf8",
          signal,
          env: { ...process.env, LC_ALL: "C", LANG: "C" },
        },
        (error, stdout, stderr) => {
          if (error) {
            if (signal.aborted) {
              reject(
                uploadError(408, "UPLOAD_ABORTED", "The upload was interrupted or timed out."),
              );
            } else if (error.code === "ENOENT" || error.code === "EACCES") {
              reject(
                uploadError(
                  503,
                  "PDF_VALIDATOR_UNAVAILABLE",
                  "PDF validation is temporarily unavailable.",
                ),
              );
            } else {
              reject(
                uploadError(
                  422,
                  "INVALID_PDF",
                  "The PDF is unreadable, encrypted, or could not be validated within the limit.",
                ),
              );
            }
          } else if (/Syntax Error:/iu.test(stderr)) {
            reject(uploadError(422, "INVALID_PDF", "The PDF contains invalid structure."));
          } else resolve(stdout);
        },
      );
    });
    if (!/^Pages:\s+[1-9]\d*\s*$/mu.test(output) || !/^Encrypted:\s+no\s*$/mu.test(output)) {
      throw uploadError(422, "INVALID_PDF", "The PDF must be readable and unencrypted.");
    }
    throwIfUploadAborted(signal);
  };
}
