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

The request deadline cancels streaming, PDF validation, and S3 calls. Upload database work uses a
separate pool with at most `UPLOAD_MAX_CONCURRENT` additional connections per API process (the
ordinary API/auth pool still permits 25). A connection is leased only during a database phase, never
while receiving a file, validating it, or calling S3. All PDFs are validated, including checksum reuse;
existing records do not carry validation provenance.

Database acquisition and connection establishment are bounded to five seconds, statement execution to
15 seconds, lock waits to five seconds, and each database phase to 30 seconds or the remaining upload
deadline, whichever is shorter. These defaults live in the scoped persistence constructor and pool. Cancelled
waiters cannot execute later. Cancellation is checked inside the transaction before commit; an active
database operation gets up to two seconds to settle before its exclusive client is terminated and
discarded. Cleanup waits for settlement, so a response can extend beyond the request deadline by this
grace period. Other upload clients and the API/auth pool are unaffected.

Database capacity/timeouts return HTTP 503 `UPLOAD_DATABASE_UNAVAILABLE`; request interruption or
deadline expiry returns HTTP 408 `UPLOAD_ABORTED`. A confirmed commit remains success if cancellation
arrives while commit is settling. A lost commit response remains uncertain and retains the object.
Closing a connection or racing a promise does not prove that a transaction rolled back. Temporary files are
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

## Code organization

`apps/api/src/uploads/service.ts` owns upload admission, the request deadline, file and storage work,
error mapping, and cleanup. It shows three database scopes: workspace ownership before receiving the
file, checksum lookup after PDF validation, and the final publication transaction. No connection is
leased during file reception, PDF validation, or S3 calls.

`uploads/publication.ts` performs workspace revalidation, document resolution, attachment, and job
creation or lookup using the transaction-bound repositories supplied by the service. It does not open
another transaction. `uploads/types.ts` holds their shared contracts; the service still re-exports its
original public types.

`packages/db/src/unit_of_work/scoped.ts` remains the persistence entrypoint and constructor. Its
`scoped/` directory separates contracts, database errors, pool lifecycle, and the Postgres connection
adapter. The adapter owns the sockets needed for forced retirement; the pool owns acquisition,
deadlines, settlement, and shutdown. Ordinary API operations continue to use `UnitOfWork` and its
long-lived repositories. Scoped persistence instead leases exclusive database access for each callback.

Callbacks must await database work and check the supplied phase signal before further work. That
signal includes database phase expiry and shutdown as well as upload cancellation. The upload signal
also remains necessary for HTTP error precedence. Cancellation checks and commit settlement must stay
in their current order: a confirmed commit is success even if cancellation arrives during COMMIT.

## Verification

Run unit tests and static checks with pnpm filters for `@repo/api`, `@repo/db`, `@repo/env`, and
`@repo/object-storage`. Unit tests cover streaming, cancellation, authentication, ownership, public
responses, duplicate resolution, publication failures, and PDF subprocess bounds.
CI runs the real PDF and upload database integration suites on Node 24 against a disposable pgvector
PostgreSQL service with all migrations applied. Local integration execution remains opt-in.

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
and both attachment/deletion orderings. Contention tests inspect PostgreSQL blocking backend IDs
before releasing the competing transaction. The suite also checks statement and lock timeouts,
connection reuse after rollback, and cancellation before commit. Existing S3 contract tests remain separately opt-in with
their dedicated nonproduction storage settings.
