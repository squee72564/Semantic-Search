import { z } from "zod";
import { attachDocumentSchema, updateDocumentMetadataSchema } from "../validation/document.js";
import { uploadError } from "./errors.js";

export const uploadMetadataSchema = z
  .object({
    ...updateDocumentMetadataSchema.shape,
    ...attachDocumentSchema.shape,
  })
  .strict();

export type UploadMetadata = z.infer<typeof uploadMetadataSchema>;

export function parseUploadMetadata(value: string | undefined): UploadMetadata {
  try {
    return uploadMetadataSchema.parse(value === undefined ? {} : JSON.parse(value));
  } catch {
    throw uploadError(
      400,
      "INVALID_UPLOAD_METADATA",
      "Upload metadata must be a valid JSON metadata object.",
    );
  }
}
