import { Readable } from "node:stream";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import type { S3StorageConfig } from "./config.js";
import {
  createS3Storage,
  createS3StorageFromClient,
  ObjectStorageError,
  type ObjectStorage,
} from "./storage.js";

const bucket = "test-bucket";
const sha256 = "a".repeat(64);

interface MockStorage {
  readonly destroy: ReturnType<typeof vi.fn<() => void>>;
  readonly send: ReturnType<typeof vi.fn<(...arguments_: unknown[]) => Promise<unknown>>>;
  readonly storage: ObjectStorage;
}

function createMockStorage(...responses: unknown[]): MockStorage {
  const send = vi.fn<(...arguments_: unknown[]) => Promise<unknown>>();
  for (const response of responses) {
    if (response instanceof Error) {
      send.mockRejectedValueOnce(response);
    } else {
      send.mockResolvedValueOnce(response);
    }
  }
  const destroy = vi.fn<() => void>();
  const client = new S3Client({
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    region: "test-1",
  });
  Object.defineProperties(client, {
    destroy: { value: destroy },
    send: { value: send },
  });
  return { destroy, send, storage: createS3StorageFromClient(bucket, client) };
}

function providerError(name: string, status: number): Error {
  return Object.assign(new Error(name), {
    $metadata: { httpStatusCode: status },
    name,
  });
}

async function storageErrorFrom(promise: Promise<unknown>): Promise<ObjectStorageError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof ObjectStorageError)) {
    throw error ?? new Error("Expected object storage operation to fail");
  }
  return error;
}

describe("S3 object storage", () => {
  it("creates an adapter without exposing its bucket or S3 client", () => {
    const destroy = vi.spyOn(S3Client.prototype, "destroy").mockImplementation(() => undefined);
    const config: S3StorageConfig = {
      accessKeyId: "access-key",
      bucket,
      endpoint: "https://objects.example.test",
      forcePathStyle: true,
      region: "test-1",
      secretAccessKey: "secret-key",
    };

    const storage = createS3Storage(config);
    expect(storage).not.toHaveProperty("bucket");
    expect(storage).not.toHaveProperty("client");
    expect(storage).toMatchObject({
      close: expect.any(Function),
      delete: expect.any(Function),
      get: expect.any(Function),
      head: expect.any(Function),
      list: expect.any(Function),
      put: expect.any(Function),
    });

    storage.close();
    storage.close();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("uploads immutable objects with publication metadata and cancellation", async () => {
    const { send, storage } = createMockStorage({ ETag: '"opaque"' });
    const controller = new AbortController();
    const body = new Uint8Array([1, 2, 3]);

    await expect(
      storage.put(
        {
          body,
          contentType: "application/pdf",
          key: "documents/original.pdf",
          metadata: { Source: "upload" },
          sha256,
          size: body.byteLength,
        },
        { signal: controller.signal },
      ),
    ).resolves.toEqual({
      contentType: "application/pdf",
      etag: '"opaque"',
      key: "documents/original.pdf",
      metadata: { sha256, source: "upload" },
      sha256,
      size: 3,
    });

    const call = send.mock.calls[0];
    if (call === undefined) throw new Error("Expected an S3 command");
    const [command, options] = call;
    expect(command).toBeInstanceOf(PutObjectCommand);
    if (!(command instanceof PutObjectCommand)) throw new Error("Expected a put command");
    expect(command.input).toMatchObject({
      Body: body,
      Bucket: bucket,
      ContentLength: 3,
      ContentType: "application/pdf",
      IfNoneMatch: "*",
      Key: "documents/original.pdf",
      Metadata: { sha256, source: "upload" },
    });
    expect(options).toMatchObject({ abortSignal: controller.signal });
  });

  it.each([
    ["invalid size", { body: new Uint8Array(), contentType: "x", key: "key", sha256, size: -1 }],
    [
      "empty content type",
      { body: new Uint8Array(), contentType: "", key: "key", sha256, size: 0 },
    ],
    [
      "invalid checksum",
      { body: new Uint8Array(), contentType: "x", key: "key", sha256: "bad", size: 0 },
    ],
    [
      "body length mismatch",
      { body: new Uint8Array([1]), contentType: "x", key: "key", sha256, size: 2 },
    ],
    [
      "reserved metadata",
      {
        body: new Uint8Array(),
        contentType: "x",
        key: "key",
        metadata: { SHA256: sha256 },
        sha256,
        size: 0,
      },
    ],
  ])("rejects %s before sending", async (_name, input) => {
    const { send, storage } = createMockStorage();
    await expect(storageErrorFrom(storage.put(input))).resolves.toMatchObject({
      code: "invalid_input",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("accepts a Node readable upload without buffering it", async () => {
    const { send, storage } = createMockStorage({});
    const body = Readable.from([Buffer.from("abc")]);
    await storage.put({ body, contentType: "text/plain", key: "stream", sha256, size: 3 });

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    if (!(command instanceof PutObjectCommand)) throw new Error("Expected a put command");
    expect(command.input.Body).toBe(body);
  });

  it.each([
    [412, "already_exists", false],
    [409, "conflict", true],
  ])("normalizes conditional write status %i", async (status, code, retryable) => {
    const { storage } = createMockStorage(providerError("ProviderError", status));
    const error = await storageErrorFrom(
      storage.put({
        body: new Uint8Array(),
        contentType: "text/plain",
        key: "key",
        sha256,
        size: 0,
      }),
    );
    expect(error).toMatchObject({ code });
    expect(error.retryable).toBe(retryable);
  });

  it("returns normalized metadata from head", async () => {
    const modified = new Date("2026-01-02T03:04:05.000Z");
    const { send, storage } = createMockStorage({
      ContentLength: 42,
      ContentType: "application/pdf",
      ETag: '"etag"',
      LastModified: modified,
      Metadata: { SHA256: sha256, Source: "worker" },
    });

    await expect(storage.head("key")).resolves.toEqual({
      contentType: "application/pdf",
      etag: '"etag"',
      key: "key",
      lastModified: modified,
      metadata: { sha256, source: "worker" },
      sha256,
      size: 42,
    });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand);
  });

  it("returns null only for missing head responses", async () => {
    const missing = createMockStorage(providerError("NotFound", 404));
    await expect(missing.storage.head("missing")).resolves.toBeNull();

    const denied = createMockStorage(providerError("AccessDenied", 403));
    await expect(storageErrorFrom(denied.storage.head("secret"))).resolves.toMatchObject({
      code: "request_failed",
    });
  });

  it.each([
    [{ start: 4 }, "bytes=4-"],
    [{ end: 8, start: 4 }, "bytes=4-8"],
    [{ suffixLength: 5 }, "bytes=-5"],
  ] as const)("streams range %j", async (range, expectedHeader) => {
    const body = Readable.from([Buffer.from("hello")]);
    const { send, storage } = createMockStorage({
      Body: body,
      ContentLength: 5,
      ContentRange: "bytes 4-8/20",
      ContentType: "text/plain",
      Metadata: { sha256 },
    });

    await expect(storage.get("key", range)).resolves.toMatchObject({
      body,
      contentLength: 5,
      contentRange: { end: 8, start: 4, total: 20 },
      contentType: "text/plain",
      sha256,
    });
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(GetObjectCommand);
    if (!(command instanceof GetObjectCommand)) throw new Error("Expected a get command");
    expect(command.input.Range).toBe(expectedHeader);
  });

  it("streams a complete object without content-range metadata", async () => {
    const body = Readable.from(["content"]);
    const { storage } = createMockStorage({ Body: body, ContentLength: 7 });
    await expect(storage.get("key")).resolves.toEqual({
      body,
      contentLength: 7,
      metadata: {},
    });
  });

  it.each([
    [{ start: -1 }, "invalid_range"],
    [{ end: 1, start: 2 }, "invalid_range"],
    [{ suffixLength: 0 }, "invalid_range"],
  ] as const)("rejects invalid range %j", async (range, code) => {
    const { send, storage } = createMockStorage();
    await expect(storageErrorFrom(storage.get("key", range))).resolves.toMatchObject({ code });
    expect(send).not.toHaveBeenCalled();
  });

  it("normalizes missing objects, unsatisfiable ranges, and invalid bodies", async () => {
    await expect(
      storageErrorFrom(createMockStorage(providerError("NoSuchKey", 404)).storage.get("missing")),
    ).resolves.toMatchObject({ code: "not_found" });
    await expect(
      storageErrorFrom(
        createMockStorage(providerError("InvalidRange", 416)).storage.get("key", { start: 99 }),
      ),
    ).resolves.toMatchObject({ code: "invalid_range" });
    await expect(
      storageErrorFrom(
        createMockStorage({ Body: new Uint8Array(), ContentLength: 0 }).storage.get("key"),
      ),
    ).resolves.toMatchObject({ code: "invalid_response" });
  });

  it("lazily paginates listings", async () => {
    const modified = new Date("2026-01-01T00:00:00.000Z");
    const { send, storage } = createMockStorage(
      {
        Contents: [{ ETag: '"one"', Key: "prefix/one", LastModified: modified, Size: 1 }],
        IsTruncated: true,
        NextContinuationToken: "next",
      },
      { Contents: [{ Key: "prefix/two", Size: 2 }], IsTruncated: false },
    );

    const iterator = storage.list("prefix/");
    expect(send).not.toHaveBeenCalled();
    const objects = [];
    for await (const object of iterator) objects.push(object);

    expect(objects).toEqual([
      { etag: '"one"', key: "prefix/one", lastModified: modified, size: 1 },
      { key: "prefix/two", size: 2 },
    ]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(ListObjectsV2Command);
    const secondCommand = send.mock.calls[1]?.[0];
    expect(secondCommand).toBeInstanceOf(ListObjectsV2Command);
    if (!(secondCommand instanceof ListObjectsV2Command)) throw new Error("Expected list command");
    expect(secondCommand.input.ContinuationToken).toBe("next");
  });

  it("rejects malformed pagination instead of looping", async () => {
    const { storage } = createMockStorage({ IsTruncated: true });
    await expect(storageErrorFrom(collect(storage.list("")))).resolves.toMatchObject({
      code: "invalid_response",
    });
  });

  it("deletes through S3 and permits repeated deletion", async () => {
    const { send, storage } = createMockStorage({}, {});
    await storage.delete("key");
    await storage.delete("key");
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(DeleteObjectCommand);
  });

  it("normalizes aborts and retryable service failures", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    await expect(
      storageErrorFrom(createMockStorage(abort).storage.delete("key")),
    ).resolves.toMatchObject({ code: "aborted" });

    const error = await storageErrorFrom(
      createMockStorage(providerError("ServiceUnavailable", 503)).storage.delete("key"),
    );
    expect(error).toMatchObject({ code: "request_failed" });
    expect(error.retryable).toBe(true);
  });

  it("destroys its client once and rejects operations after close", async () => {
    const { destroy, send, storage } = createMockStorage();
    storage.close();
    storage.close();
    expect(destroy).toHaveBeenCalledOnce();
    await expect(storageErrorFrom(storage.head("key"))).resolves.toMatchObject({ code: "closed" });
    expect(send).not.toHaveBeenCalled();
  });
});

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}
