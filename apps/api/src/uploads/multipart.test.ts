import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { multipartBody, uploadRequest } from "../../test/upload-fixtures.js";
import { prepareMultipartUpload } from "./multipart.js";
const signal = () => new AbortController().signal;

describe("streaming multipart preparation", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "upload-test-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const limits = () => ({
    temporaryRoot: root,
    maxFileBytes: 1024,
    maxMetadataBytes: 100,
    maxOverheadBytes: 1024,
  });

  it("writes incremental file bytes and hashes them, without buffering the Request body", async () => {
    const payload = multipartBody("%PDF-1.7\nexample", '{"tags":[" Tax ","tax"]}');
    let offset = 0;
    const request = new Request("http://localhost/upload", {
      method: "POST",
      headers: { "content-type": payload.contentType },
      duplex: "half",
      body: new ReadableStream({
        pull(controller) {
          if (offset === payload.body.length) {
            controller.close();
            return;
          }
          controller.enqueue(payload.body.subarray(offset, offset + 7));
          offset = Math.min(offset + 7, payload.body.length);
        },
      }),
    });
    const arrayBuffer = vi.spyOn(request, "arrayBuffer");
    const formData = vi.spyOn(request, "formData");
    const prepared = await prepareMultipartUpload(request, limits(), signal());
    expect(await readFile(prepared.path, "utf8")).toBe("%PDF-1.7\nexample");
    expect(prepared.sha256).toBe(createHash("sha256").update("%PDF-1.7\nexample").digest("hex"));
    expect(prepared.metadata.tags).toEqual(["tax"]);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(formData).not.toHaveBeenCalled();
    await prepared.cleanup();
    expect(await readdir(root)).toEqual([]);
  });

  it.each([undefined, "1", "100000"])(
    "enforces actual file bytes with Content-Length %s",
    async (contentLength) => {
      const request = uploadRequest(
        multipartBody(Buffer.alloc(1025)),
        contentLength === undefined ? {} : { contentLength },
      );
      await expect(prepareMultipartUpload(request, limits(), signal())).rejects.toMatchObject({
        status: 413,
      });
      expect(await readdir(root)).toEqual([]);
    },
  );

  it("accepts exactly the file limit", async () => {
    const prepared = await prepareMultipartUpload(
      uploadRequest(multipartBody(Buffer.alloc(1024))),
      limits(),
      signal(),
    );
    expect(prepared.size).toBe(1024);
    await prepared.cleanup();
  });

  it("stops reading an oversized producer without buffering the rest of the upload", async () => {
    const payload = multipartBody();
    const fileStart = payload.body.indexOf("\r\n\r\n") + 4;
    let pulls = 0;
    let cancelled = false;
    const request = new Request("http://localhost/upload", {
      method: "POST",
      duplex: "half",
      headers: { "content-type": payload.contentType },
      body: new ReadableStream({
        pull(controller) {
          pulls += 1;
          controller.enqueue(
            pulls === 1 ? payload.body.subarray(0, fileStart) : Buffer.alloc(16384),
          );
          if (pulls === 1000) controller.close();
        },
        cancel() {
          cancelled = true;
        },
      }),
    });
    await expect(prepareMultipartUpload(request, limits(), signal())).rejects.toMatchObject({
      status: 413,
    });
    expect(pulls).toBeLessThan(10);
    expect(cancelled).toBe(true);
    expect(await readdir(root)).toEqual([]);
  });

  it.each([
    ["empty", multipartBody(""), 422],
    ["invalid JSON", multipartBody("pdf", "{"), 400],
    ["unknown metadata", multipartBody("pdf", '{"userId":"someone"}'), 400],
    ["oversized metadata", multipartBody("pdf", "x".repeat(101)), 413],
    ["unsafe filename", multipartBody("pdf", undefined, "../source.pdf"), 400],
    ["missing filename", multipartBody("pdf", undefined, ""), 400],
  ])("cleans temporary files after %s", async (_name, body, status) => {
    await expect(
      prepareMultipartUpload(uploadRequest(body), limits(), signal()),
    ).rejects.toMatchObject({ status });
    expect(await readdir(root)).toEqual([]);
  });

  it("rejects truncated multipart input", async () => {
    const payload = multipartBody();
    payload.body = payload.body.subarray(0, payload.body.length - 30);
    await expect(
      prepareMultipartUpload(uploadRequest(payload), limits(), signal()),
    ).rejects.toMatchObject({ status: 400 });
    expect(await readdir(root)).toEqual([]);
  });

  it("rejects a second file", async () => {
    const payload = multipartBody();
    const second = Buffer.from(
      payload.body.toString().replace('filename="source.pdf"', 'filename="second.pdf"'),
    );
    payload.body = Buffer.concat([payload.body.subarray(0, payload.body.length - 26), second]);
    await expect(
      prepareMultipartUpload(uploadRequest(payload), limits(), signal()),
    ).rejects.toMatchObject({ status: 400 });
    expect(await readdir(root)).toEqual([]);
  });

  it("cancels a stalled stream and removes the partially written file", async () => {
    const controller = new AbortController();
    const payload = multipartBody();
    let cancelled = false;
    const request = new Request("http://localhost/upload", {
      method: "POST",
      duplex: "half",
      headers: { "content-type": payload.contentType },
      body: new ReadableStream({
        start(stream) {
          stream.enqueue(payload.body.subarray(0, payload.body.length - 30));
        },
        cancel() {
          cancelled = true;
        },
      }),
    });
    const preparing = prepareMultipartUpload(request, limits(), controller.signal);
    setTimeout(() => controller.abort(), 30);
    await expect(preparing).rejects.toMatchObject({ status: 408 });
    expect(cancelled).toBe(true);
    expect(await readdir(root)).toEqual([]);
  });

  it("rejects unsupported media and missing multipart boundaries", async () => {
    await expect(
      prepareMultipartUpload(
        new Request("http://localhost", { method: "POST", body: "pdf" }),
        limits(),
        signal(),
      ),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      prepareMultipartUpload(
        new Request("http://localhost", {
          method: "POST",
          body: "pdf",
          headers: { "content-type": "multipart/form-data" },
        }),
        limits(),
        signal(),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
