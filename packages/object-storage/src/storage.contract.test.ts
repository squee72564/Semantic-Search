import { createHash, randomUUID } from "node:crypto";
import type { Readable } from "node:stream";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { S3StorageConfig } from "./config.js";
import { createS3Storage, type ObjectStorage } from "./storage.js";

const contractEnabled = process.env.S3_CONTRACT_TESTS === "true";

describe.runIf(contractEnabled)("S3-compatible object storage contract", () => {
  let storage: ObjectStorage;
  const createdKeys = new Set<string>();
  const prefix = `contract/${randomUUID()}/`;

  beforeAll(() => {
    const config = readContractConfig();
    storage = createS3Storage(config);
  });

  afterAll(async () => {
    if (storage === undefined) return;

    await Promise.allSettled([...createdKeys].map((key) => storage.delete(key)));
    storage.close();
  });

  it("supports the application's essential object operations", async () => {
    const key = `${prefix}object.txt`;
    const body = Buffer.from("S3-compatible contract payload", "utf8");
    const sha256 = createHash("sha256").update(body).digest("hex");
    createdKeys.add(key);

    await expect(
      storage.put({
        body,
        contentType: "text/plain",
        key,
        metadata: { contract: "object-storage" },
        sha256,
        size: body.byteLength,
      }),
    ).resolves.toMatchObject({ key, sha256, size: body.byteLength });

    const duplicate = storage.put({
      body: Buffer.from("replacement", "utf8"),
      contentType: "text/plain",
      key,
      sha256: createHash("sha256").update("replacement").digest("hex"),
      size: Buffer.byteLength("replacement"),
    });
    await expect(duplicate).rejects.toMatchObject({
      code: "already_exists",
      operation: "put",
    });

    await expect(storage.head(key)).resolves.toMatchObject({
      contentType: "text/plain",
      key,
      metadata: { contract: "object-storage", sha256 },
      sha256,
      size: body.byteLength,
    });

    const complete = await storage.get(key);
    await expect(readStream(complete.body)).resolves.toEqual(body);

    const ranged = await storage.get(key, { end: 10, start: 3 });
    expect(ranged.contentRange).toEqual({ end: 10, start: 3, total: body.byteLength });
    await expect(readStream(ranged.body)).resolves.toEqual(body.subarray(3, 11));

    const listed = [];
    for await (const object of storage.list(prefix)) listed.push(object);
    expect(listed).toContainEqual(expect.objectContaining({ key, size: body.byteLength }));

    await storage.delete(key);
    await storage.delete(key);
    await expect(storage.head(key)).resolves.toBeNull();
    await expect(storage.get(key)).rejects.toMatchObject({
      code: "not_found",
      operation: "get",
    });
    createdKeys.delete(key);
  });
});

function readContractConfig(): S3StorageConfig {
  if (process.env.S3_CONTRACT_NON_PRODUCTION !== "true") {
    throw new Error("Set S3_CONTRACT_NON_PRODUCTION=true to confirm the target is non-production");
  }

  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE ?? "false";
  if (forcePathStyle !== "true" && forcePathStyle !== "false") {
    throw new Error("S3_FORCE_PATH_STYLE must be true or false");
  }

  return {
    accessKeyId: requiredEnvironmentVariable("S3_ACCESS_KEY_ID"),
    bucket: requiredEnvironmentVariable("S3_BUCKET"),
    endpoint: requiredEnvironmentVariable("S3_ENDPOINT"),
    forcePathStyle: forcePathStyle === "true",
    region: requiredEnvironmentVariable("S3_REGION"),
    secretAccessKey: requiredEnvironmentVariable("S3_SECRET_ACCESS_KEY"),
  };
}

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for object-storage contract tests`);
  }
  return value;
}

async function readStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (typeof chunk === "string" || chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
    } else {
      throw new TypeError("Object stream yielded a non-byte chunk");
    }
  }
  return Buffer.concat(chunks);
}
