import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import busboy from "busboy";
import { ApiError } from "../lib/error.js";
import { throwIfUploadAborted, uploadError } from "./errors.js";
import { parseUploadMetadata, type UploadMetadata } from "./metadata.js";

export interface PreparedUpload {
  path: string;
  filename: string;
  size: number;
  sha256: string;
  metadata: UploadMetadata;
  cleanup: () => Promise<void>;
}

export interface MultipartLimits {
  maxFileBytes: number;
  maxMetadataBytes: number;
  maxOverheadBytes: number;
  temporaryRoot?: string;
}

export async function prepareMultipartUpload(
  request: Request,
  limits: MultipartLimits,
  signal: AbortSignal,
): Promise<PreparedUpload> {
  throwIfUploadAborted(signal);
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data(?:\s*;|$)/iu.test(contentType)) {
    throw uploadError(
      415,
      "UNSUPPORTED_UPLOAD_MEDIA_TYPE",
      "Use multipart/form-data for PDF uploads.",
    );
  }
  if (!request.body) throw uploadError(400, "MISSING_UPLOAD_FILE", "One PDF file is required.");
  const maxRequestBytes = limits.maxFileBytes + limits.maxMetadataBytes + limits.maxOverheadBytes;
  const declaredSize = request.headers.get("content-length");
  if (declaredSize !== null && Number(declaredSize) > maxRequestBytes) {
    throw uploadError(413, "UPLOAD_TOO_LARGE", "The upload exceeds the size limit.");
  }
  let parser: ReturnType<typeof busboy>;
  try {
    parser = busboy({
      headers: { "content-type": contentType },
      preservePath: true,
      defParamCharset: "utf8",
      limits: {
        files: 1,
        fields: 1,
        parts: 3,
        fileSize: limits.maxFileBytes + 1,
        fieldSize: limits.maxMetadataBytes + 1,
      },
    });
  } catch {
    throw uploadError(400, "INVALID_MULTIPART", "The multipart upload is malformed.");
  }
  const directory = await mkdtemp(join(limits.temporaryRoot ?? tmpdir(), "document-upload-"));
  const path = join(directory, "original.pdf");
  const cleanup = () => rm(directory, { recursive: true, force: true });
  const controller = new AbortController();
  const combinedSignal = AbortSignal.any([signal, controller.signal]);
  let failure: unknown;
  const fail = (error: unknown) => {
    failure ??= error;
    controller.abort();
  };
  let size = 0;
  let requestBytes = 0;
  let filename: string | undefined;
  let metadataText: string | undefined;
  let fileWrite: Promise<void> | undefined;
  const hash = createHash("sha256");
  const malformed = () =>
    fail(uploadError(400, "INVALID_MULTIPART", "Provide one file and at most one metadata field."));
  parser.on("filesLimit", malformed);
  parser.on("fieldsLimit", malformed);
  parser.on("partsLimit", malformed);
  parser.on("field", (name, value, info) => {
    if (name !== "metadata" || metadataText !== undefined || info.nameTruncated) return malformed();
    if (info.valueTruncated || Buffer.byteLength(value) > limits.maxMetadataBytes) {
      return fail(
        uploadError(413, "UPLOAD_METADATA_TOO_LARGE", "Upload metadata exceeds the size limit."),
      );
    }
    metadataText = value;
  });
  parser.on("file", (name, file, info) => {
    // Client names are display metadata, never local paths or object keys.
    if (
      name !== "file" ||
      filename !== undefined ||
      typeof info.filename !== "string" ||
      !info.filename.trim() ||
      Array.from(info.filename).length > 255 ||
      /[/\\:]/u.test(info.filename) ||
      Array.from(info.filename).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      info.filename === "." ||
      info.filename === ".."
    ) {
      file.resume();
      return fail(
        uploadError(400, "INVALID_UPLOAD_FILENAME", "Provide one file with a valid filename."),
      );
    }
    filename = info.filename;
    file.on("limit", () =>
      fail(uploadError(413, "UPLOAD_TOO_LARGE", "The PDF exceeds the size limit.")),
    );
    const measure = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > limits.maxFileBytes)
          return callback(uploadError(413, "UPLOAD_TOO_LARGE", "The PDF exceeds the size limit."));
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    // Attach rejection handling immediately; both pipelines must settle before removing the file.
    fileWrite = pipeline(file, measure, createWriteStream(path, { flags: "wx", mode: 0o600 }), {
      signal: combinedSignal,
    }).catch(fail);
  });
  const countRequest = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      requestBytes += chunk.length;
      callback(
        requestBytes > maxRequestBytes
          ? uploadError(413, "UPLOAD_TOO_LARGE", "The upload exceeds the size limit.")
          : null,
        chunk,
      );
    },
  });
  try {
    await pipeline(Readable.fromWeb(request.body), countRequest, parser, {
      signal: combinedSignal,
    }).catch(fail);
    await fileWrite;
    throwIfUploadAborted(signal);
    if (failure) {
      if (failure instanceof ApiError) throw failure;
      // Filesystem failures are operational failures, not malformed user input.
      if (
        failure instanceof Error &&
        "code" in failure &&
        ["ENOSPC", "EACCES", "EIO"].includes(String(failure.code))
      )
        throw failure;
      throw uploadError(
        400,
        "INVALID_MULTIPART",
        "The multipart upload is malformed or incomplete.",
      );
    }
    if (!filename || !fileWrite)
      throw uploadError(400, "MISSING_UPLOAD_FILE", "One PDF file is required.");
    if (size === 0) throw uploadError(422, "EMPTY_PDF", "The PDF must not be empty.");
    return {
      path,
      filename,
      size,
      sha256: hash.digest("hex"),
      metadata: parseUploadMetadata(metadataText),
      cleanup,
    };
  } catch (error) {
    controller.abort();
    await fileWrite;
    await cleanup();
    throw error;
  }
}
