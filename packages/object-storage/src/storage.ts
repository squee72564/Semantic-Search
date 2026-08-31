import { Readable } from "node:stream";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { S3StorageConfig } from "./config.js";

export type ObjectBody = Readable | Uint8Array;
export type ObjectStorageOperation = "delete" | "get" | "head" | "list" | "put";
export type ObjectStorageErrorCode =
  | "aborted"
  | "already_exists"
  | "closed"
  | "conflict"
  | "invalid_input"
  | "invalid_range"
  | "invalid_response"
  | "not_found"
  | "request_failed";

export interface ObjectStorageRequestOptions {
  readonly signal?: AbortSignal;
}

export interface PutObjectInput {
  readonly body: ObjectBody;
  readonly contentType: string;
  readonly key: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly sha256: string;
  readonly size: number;
}

export type ByteRange =
  | { readonly end?: number; readonly start: number; readonly suffixLength?: never }
  | { readonly end?: never; readonly start?: never; readonly suffixLength: number };

export interface StoredObject {
  readonly contentType: string;
  readonly etag?: string;
  readonly key: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly sha256: string;
  readonly size: number;
}

export interface StoredObjectMetadata {
  readonly contentType?: string;
  readonly etag?: string;
  readonly key: string;
  readonly lastModified?: Date;
  readonly metadata: Readonly<Record<string, string>>;
  readonly sha256?: string;
  readonly size: number;
}

export interface ObjectContentRange {
  readonly end: number;
  readonly start: number;
  readonly total: number;
}

export interface ObjectStream {
  readonly body: Readable;
  readonly contentLength: number;
  readonly contentRange?: ObjectContentRange;
  readonly contentType?: string;
  readonly etag?: string;
  readonly lastModified?: Date;
  readonly metadata: Readonly<Record<string, string>>;
  readonly sha256?: string;
}

export interface ListedObject {
  readonly etag?: string;
  readonly key: string;
  readonly lastModified?: Date;
  readonly size: number;
}

export interface ObjectStorage {
  put(input: PutObjectInput, options?: ObjectStorageRequestOptions): Promise<StoredObject>;
  head(key: string, options?: ObjectStorageRequestOptions): Promise<StoredObjectMetadata | null>;
  get(key: string, range?: ByteRange, options?: ObjectStorageRequestOptions): Promise<ObjectStream>;
  list(prefix: string, options?: ObjectStorageRequestOptions): AsyncIterable<ListedObject>;
  delete(key: string, options?: ObjectStorageRequestOptions): Promise<void>;
  close(): void;
}

export interface ObjectStorageErrorOptions {
  readonly cause?: unknown;
  readonly code: ObjectStorageErrorCode;
  readonly key?: string | undefined;
  readonly operation: ObjectStorageOperation;
  readonly retryable?: boolean | undefined;
}

export class ObjectStorageError extends Error {
  readonly code: ObjectStorageErrorCode;
  readonly key?: string;
  readonly operation: ObjectStorageOperation;
  readonly retryable: boolean;

  constructor(message: string, options: ObjectStorageErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "ObjectStorageError";
    this.code = options.code;
    this.operation = options.operation;
    this.retryable = options.retryable ?? false;

    if (options.key !== undefined) {
      this.key = options.key;
    }
  }
}

const sha256Pattern = /^[a-f\d]{64}$/u;
const contentRangePattern = /^bytes (\d+)-(\d+)\/(\d+)$/u;

class S3ObjectStorage implements ObjectStorage {
  readonly #bucket: string;
  readonly #client: S3Client;
  #closed = false;

  constructor(bucket: string, client: S3Client) {
    this.#bucket = bucket;
    this.#client = client;
  }

  async put(input: PutObjectInput, options?: ObjectStorageRequestOptions): Promise<StoredObject> {
    this.#assertOpen("put", input.key);
    validateKey(input.key, "put");

    if (!Number.isSafeInteger(input.size) || input.size < 0) {
      throw storageError("put", "invalid_input", "Object size must be a nonnegative safe integer", {
        key: input.key,
      });
    }

    if (input.contentType.trim().length === 0) {
      throw storageError("put", "invalid_input", "Object content type must not be empty", {
        key: input.key,
      });
    }

    if (!sha256Pattern.test(input.sha256)) {
      throw storageError(
        "put",
        "invalid_input",
        "Object SHA-256 must be a lowercase 64-character hexadecimal string",
        { key: input.key },
      );
    }

    if (!(input.body instanceof Readable) && !(input.body instanceof Uint8Array)) {
      throw storageError("put", "invalid_input", "Object body must be a Readable or Uint8Array", {
        key: input.key,
      });
    }

    if (input.body instanceof Uint8Array && input.body.byteLength !== input.size) {
      throw storageError("put", "invalid_input", "Object body length does not match its size", {
        key: input.key,
      });
    }

    const metadata = normalizeInputMetadata(input.metadata, input.key);
    metadata.sha256 = input.sha256;

    try {
      const output = await this.#client.send(
        new PutObjectCommand({
          Body: input.body,
          Bucket: this.#bucket,
          ContentLength: input.size,
          ContentType: input.contentType,
          IfNoneMatch: "*",
          Key: input.key,
          Metadata: metadata,
        }),
        requestOptions(options),
      );

      return {
        contentType: input.contentType,
        ...(output.ETag === undefined ? {} : { etag: output.ETag }),
        key: input.key,
        metadata: Object.freeze({ ...metadata }),
        sha256: input.sha256,
        size: input.size,
      };
    } catch (error) {
      throw normalizeError(error, "put", input.key);
    }
  }

  async head(
    key: string,
    options?: ObjectStorageRequestOptions,
  ): Promise<StoredObjectMetadata | null> {
    this.#assertOpen("head", key);
    validateKey(key, "head");

    try {
      const output = await this.#client.send(
        new HeadObjectCommand({ Bucket: this.#bucket, Key: key }),
        requestOptions(options),
      );

      if (!isNonnegativeSafeInteger(output.ContentLength)) {
        throw storageError("head", "invalid_response", "Object metadata omitted a valid size", {
          key,
        });
      }

      const metadata = normalizeOutputMetadata(output.Metadata);
      const sha256 = validStoredSha256(metadata.sha256);
      return {
        ...(output.ContentType === undefined ? {} : { contentType: output.ContentType }),
        ...(output.ETag === undefined ? {} : { etag: output.ETag }),
        key,
        ...(output.LastModified === undefined ? {} : { lastModified: output.LastModified }),
        metadata,
        ...(sha256 === undefined ? {} : { sha256 }),
        size: output.ContentLength,
      };
    } catch (error) {
      if (error instanceof ObjectStorageError) {
        throw error;
      }
      if (isMissingError(error)) {
        return null;
      }
      throw normalizeError(error, "head", key);
    }
  }

  async get(
    key: string,
    range?: ByteRange,
    options?: ObjectStorageRequestOptions,
  ): Promise<ObjectStream> {
    this.#assertOpen("get", key);
    validateKey(key, "get");
    const rangeHeader = range === undefined ? undefined : formatRange(range, key);

    try {
      const output = await this.#client.send(
        new GetObjectCommand({ Bucket: this.#bucket, Key: key, Range: rangeHeader }),
        requestOptions(options),
      );

      if (!(output.Body instanceof Readable)) {
        throw storageError(
          "get",
          "invalid_response",
          "Object response body is not a Node readable stream",
          {
            key,
          },
        );
      }
      if (!isNonnegativeSafeInteger(output.ContentLength)) {
        output.Body.destroy();
        throw storageError(
          "get",
          "invalid_response",
          "Object response omitted a valid content length",
          {
            key,
          },
        );
      }

      const body: Readable = output.Body;
      const contentRange = parseContentRange(output.ContentRange, rangeHeader, key);
      const metadata = normalizeOutputMetadata(output.Metadata);
      const sha256 = validStoredSha256(metadata.sha256);
      return {
        body,
        contentLength: output.ContentLength,
        ...(contentRange === undefined ? {} : { contentRange }),
        ...(output.ContentType === undefined ? {} : { contentType: output.ContentType }),
        ...(output.ETag === undefined ? {} : { etag: output.ETag }),
        ...(output.LastModified === undefined ? {} : { lastModified: output.LastModified }),
        metadata,
        ...(sha256 === undefined ? {} : { sha256 }),
      };
    } catch (error) {
      if (error instanceof ObjectStorageError) {
        throw error;
      }
      throw normalizeError(error, "get", key);
    }
  }

  async *list(prefix: string, options?: ObjectStorageRequestOptions): AsyncIterable<ListedObject> {
    this.#assertOpen("list");
    let continuationToken: string | undefined;
    const seenTokens = new Set<string>();

    do {
      let output;
      try {
        // Pagination is intentionally sequential because each request depends on the prior token.
        // eslint-disable-next-line no-await-in-loop
        output = await this.#client.send(
          new ListObjectsV2Command({
            Bucket: this.#bucket,
            ContinuationToken: continuationToken,
            Prefix: prefix,
          }),
          requestOptions(options),
        );
      } catch (error) {
        throw normalizeError(error, "list");
      }

      for (const object of output.Contents ?? []) {
        if (object.Key === undefined || !isNonnegativeSafeInteger(object.Size)) {
          throw storageError(
            "list",
            "invalid_response",
            "Object listing contained an invalid entry",
          );
        }
        yield {
          ...(object.ETag === undefined ? {} : { etag: object.ETag }),
          key: object.Key,
          ...(object.LastModified === undefined ? {} : { lastModified: object.LastModified }),
          size: object.Size,
        };
      }

      if (output.IsTruncated !== true) {
        return;
      }
      const nextToken = output.NextContinuationToken;
      if (nextToken === undefined || seenTokens.has(nextToken)) {
        throw storageError(
          "list",
          "invalid_response",
          "Truncated object listing omitted a new continuation token",
        );
      }
      seenTokens.add(nextToken);
      continuationToken = nextToken;
    } while (true);
  }

  async delete(key: string, options?: ObjectStorageRequestOptions): Promise<void> {
    this.#assertOpen("delete", key);
    validateKey(key, "delete");
    try {
      await this.#client.send(
        new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }),
        requestOptions(options),
      );
    } catch (error) {
      throw normalizeError(error, "delete", key);
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#client.destroy();
  }

  #assertOpen(operation: ObjectStorageOperation, key?: string): void {
    if (this.#closed) {
      throw storageError(operation, "closed", "Object storage is closed", { key });
    }
  }
}

export function createS3Storage(config: S3StorageConfig): ObjectStorage {
  const client = new S3Client({
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    region: config.region,
  });
  return new S3ObjectStorage(config.bucket, client);
}

/** @internal Test seam; not exported from the package entry point. */
export function createS3StorageFromClient(bucket: string, client: S3Client): ObjectStorage {
  return new S3ObjectStorage(bucket, client);
}

function validateKey(key: string, operation: ObjectStorageOperation): void {
  if (key.length === 0) {
    throw storageError(operation, "invalid_input", "Object key must not be empty", { key });
  }
}

function normalizeInputMetadata(
  input: Readonly<Record<string, string>> | undefined,
  key: string,
): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const [rawName, value] of Object.entries(input ?? {})) {
    const name = rawName.toLowerCase();
    if (name.length === 0) {
      throw storageError("put", "invalid_input", "Object metadata keys must not be empty", { key });
    }
    if (name === "sha256") {
      throw storageError("put", "invalid_input", "The sha256 metadata key is reserved", { key });
    }
    if (Object.hasOwn(metadata, name)) {
      throw storageError(
        "put",
        "invalid_input",
        "Object metadata keys must be unique ignoring case",
        {
          key,
        },
      );
    }
    metadata[name] = value;
  }
  return metadata;
}

function normalizeOutputMetadata(
  input: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  const metadata: Record<string, string> = {};
  for (const [name, value] of Object.entries(input ?? {})) {
    metadata[name.toLowerCase()] = value;
  }
  return Object.freeze(metadata);
}

function validStoredSha256(value: string | undefined): string | undefined {
  return value !== undefined && sha256Pattern.test(value) ? value : undefined;
}

function formatRange(range: ByteRange, key: string): string {
  if (range.suffixLength !== undefined) {
    if (!Number.isSafeInteger(range.suffixLength) || range.suffixLength <= 0) {
      throw storageError(
        "get",
        "invalid_range",
        "Range suffix length must be a positive safe integer",
        {
          key,
        },
      );
    }
    return `bytes=-${range.suffixLength}`;
  }
  if (!Number.isSafeInteger(range.start) || range.start < 0) {
    throw storageError("get", "invalid_range", "Range start must be a nonnegative safe integer", {
      key,
    });
  }
  if (range.end === undefined) return `bytes=${range.start}-`;
  if (!Number.isSafeInteger(range.end) || range.end < range.start) {
    throw storageError(
      "get",
      "invalid_range",
      "Range end must be a safe integer at or after start",
      {
        key,
      },
    );
  }
  return `bytes=${range.start}-${range.end}`;
}

function parseContentRange(
  value: string | undefined,
  requestedRange: string | undefined,
  key: string,
): ObjectContentRange | undefined {
  if (requestedRange === undefined) return undefined;
  const match = value?.match(contentRangePattern);
  if (match == null) {
    throw storageError("get", "invalid_response", "Ranged response omitted a valid content range", {
      key,
    });
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(total) ||
    start < 0 ||
    end < start ||
    total <= end
  ) {
    throw storageError(
      "get",
      "invalid_response",
      "Ranged response contained an invalid content range",
      {
        key,
      },
    );
  }
  return { end, start, total };
}

function requestOptions(
  options: ObjectStorageRequestOptions | undefined,
): { abortSignal?: AbortSignal } | undefined {
  return options?.signal === undefined ? undefined : { abortSignal: options.signal };
}

function normalizeError(
  error: unknown,
  operation: ObjectStorageOperation,
  key?: string,
): ObjectStorageError {
  if (error instanceof ObjectStorageError) return error;
  const name = errorName(error);
  const status = errorStatus(error);
  if (name === "AbortError") {
    return storageError(operation, "aborted", "Object storage request was aborted", {
      cause: error,
      key,
    });
  }
  if (operation === "put" && status === 412) {
    return storageError(operation, "already_exists", "Object key already exists", {
      cause: error,
      key,
    });
  }
  if (operation === "put" && status === 409) {
    return storageError(operation, "conflict", "Object write conflicted with another operation", {
      cause: error,
      key,
      retryable: true,
    });
  }
  if (operation === "get" && isMissingError(error)) {
    return storageError(operation, "not_found", "Object was not found", { cause: error, key });
  }
  if (operation === "get" && status === 416) {
    return storageError(operation, "invalid_range", "Requested object range is not satisfiable", {
      cause: error,
      key,
    });
  }
  return storageError(operation, "request_failed", "Object storage request failed", {
    cause: error,
    key,
    retryable: status === 429 || (status !== undefined && status >= 500) || hasRetryableHint(error),
  });
}

function isMissingError(error: unknown): boolean {
  const name = errorName(error);
  return errorStatus(error) === 404 || name === "NoSuchKey" || name === "NotFound";
}

function errorName(error: unknown): string | undefined {
  return isRecord(error) && typeof error.name === "string" ? error.name : undefined;
}

function errorStatus(error: unknown): number | undefined {
  if (!isRecord(error) || !isRecord(error.$metadata)) return undefined;
  const status = error.$metadata.httpStatusCode;
  return typeof status === "number" ? status : undefined;
}

function hasRetryableHint(error: unknown): boolean {
  return isRecord(error) && error.$retryable !== undefined;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function storageError(
  operation: ObjectStorageOperation,
  code: ObjectStorageErrorCode,
  message: string,
  options: Omit<ObjectStorageErrorOptions, "code" | "operation"> = {},
): ObjectStorageError {
  return new ObjectStorageError(message, { code, operation, ...options });
}
