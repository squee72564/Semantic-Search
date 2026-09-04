# Document uploads

`POST /workspaces/:workspaceId/documents` accepts an authenticated, same-origin multipart request.
The browser-facing proxy uses `/api/workspaces/:workspaceId/documents`. Send exactly one `file` part
and optionally one `metadata` text part containing a JSON object. Metadata supports `title`,
`description`, `customMetadata`, `displayTitle`, and `tags`, using the same validation as the existing
document and workspace-attachment endpoints. Filenames are display metadata, never filesystem paths.

The response is `{ document, attachment, jobId, reused }`: HTTP 201 for a new canonical document,
HTTP 200 for checksum reuse. Public document and attachment serializers omit internal storage keys
and owner IDs. A reused document returns its active processing job ID, or `null` when none exists.
Reuploading an existing document preserves its canonical metadata and processing state. A preexisting
attachment preserves its display title and tags. Failed jobs are not automatically restarted.

## Runtime and limits

Install Poppler on the API host. `PDFINFO_PATH` defaults to `pdfinfo`; it can be an absolute executable
path. On Windows point it at `pdfinfo.exe` with its supporting DLLs available, not a `.cmd` wrapper.
The API executes it without a shell, checks the PDF signature and readability, rejects encrypted PDFs
(including those with an empty user password), and bounds process duration and captured output.
Missing Poppler is reported as HTTP 503. Page-level analysis remains worker preflight work.

| Environment variable        | Default                                            |
| --------------------------- | -------------------------------------------------- |
| `UPLOAD_MAX_FILE_BYTES`     | 52428800 (50 MiB)                                  |
| `UPLOAD_MAX_METADATA_BYTES` | 65536 (64 KiB)                                     |
| `UPLOAD_MAX_OVERHEAD_BYTES` | 1048576 (1 MiB additional total request allowance) |
| `UPLOAD_MAX_CONCURRENT`     | 4 per API process                                  |
| `UPLOAD_TIMEOUT_MS`         | 300000 (five minutes)                              |
| `PDF_VALIDATION_TIMEOUT_MS` | 30000 (30 seconds)                                 |

Only the POST upload route bypasses the ordinary 1 MiB body limiter. Its parser counts actual bytes
regardless of Content-Length, streams with backpressure to an OS temporary directory, and hashes the
file incrementally. Metadata, file count, total bytes, and file bytes are bounded independently.
Authentication and workspace ownership are checked before consuming the file. The concurrency cap
covers validation, upload, and database publication; excess requests receive HTTP 503. Provision
temporary disk for at least `UPLOAD_MAX_FILE_BYTES * UPLOAD_MAX_CONCURRENT` per API process.

The request deadline cancels streaming, PDF validation, and S3 calls. A database operation already in
progress is allowed to settle; the service checks cancellation before the transaction can commit.
Do not race a database promise against a timeout and then assume it rolled back. Temporary files are
removed after request completion/failure, including disconnects. Cleanup errors are logged without
changing an already committed success. Host-level temporary-directory maintenance must account for
files left by a hard process or machine crash.

## Publication and recovery

The service publishes a new original to `documents/<generated UUID>/original.pdf` with write-once
storage semantics, verifies size, content type, and application-computed SHA-256 metadata using HEAD,
then commits its database reference, workspace attachment, and preflight job in one UoW transaction.
SHA-256 metadata is an application assertion; an ETag is never treated as a content hash.

The database's per-user checksum uniqueness resolves simultaneous identical uploads. The losing
request reuses the canonical document and creates only its attachment. Sequential reuse performs no
S3 write. Concurrent first uploads may temporarily leave redundant, unreferenced objects.
Document-row locks serialize attachment, detachment, and deletion eligibility checks. A deleting
document cannot be attached, and duplicate upload returns HTTP 409 while deletion is in progress.

PostgreSQL and S3 do not share a transaction. Objects from failed/uncertain publication and duplicate
upload races are retained, with structured reconciliation logs containing request ID, object key,
and stage. A put failure can still mean that an object reached storage; a commit failure can mean
that database publication succeeded. Do not delete these objects blindly.

**Scheduled orphan reconciliation is deferred.** A future reconciler must allow a safety window,
check database references, and distinguish unresolved publication from confirmed orphans. Until it
exists, these objects remain in storage. Monitor reconciliation and temporary-cleanup logs.
**Worker consumption is also deferred:** new jobs are durable and queued, but the current worker's
poll callback does not process them. No UI or database schema migration accompanies this endpoint.

## Verification

Run unit tests and static checks with pnpm filters for `@repo/api`, `@repo/db`, `@repo/env`, and
`@repo/object-storage`. Unit tests cover streaming, cancellation, authentication, ownership, public
responses, duplicate resolution, publication failures, and PDF subprocess bounds.

To run real PDF checks, set `PDF_VALIDATION_INTEGRATION_TESTS=true` and, if needed, `PDFINFO_PATH`, then:

```sh
pnpm --filter @repo/api exec vitest run src/uploads/pdf.integration.test.ts
```

The committed PDF fixtures are synthetic and contain no user data. Regenerate them with
`python apps/api/test/fixtures/generate_pdfs.py` using pypdf (generated with 6.10.0).

To run database tests, use a dedicated nonproduction PostgreSQL instance with the existing migrations
applied. Set `DOCUMENT_UPLOAD_INTEGRATION_TESTS=true`, `DOCUMENT_UPLOAD_TEST_NON_PRODUCTION=true`, and
`DOCUMENT_UPLOAD_TEST_DATABASE_URL` explicitly, then:

```sh
pnpm --filter @repo/db exec vitest run src/unit_of_work/index.integration.test.ts
```

These tests create isolated users and clean up only their records. They verify rollback across
nested repository transactions, visibility before commit, concurrent checksum resolution, ownership,
and both attachment/deletion orderings. Existing S3 contract tests remain separately opt-in with
their dedicated nonproduction storage settings.
