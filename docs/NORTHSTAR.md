# Semantic Document Search — North Star

Status: implementation handoff  
Audience: implementation agents and maintainers  
Deployment target: single-user web application hosted on a small VPS with managed object storage

## 1. Product intent

Build a trustworthy, general-purpose semantic-search and question-answering web application for PDF
collections. A user can upload PDFs of any kind, attach lightweight metadata, OCR and index them,
search or ask natural-language questions, and inspect the exact source pages behind every result or
answer. Documents are organized into named workspaces such as “401(k),” “Taxes,” or “Book notes.” A
workspace is the active research boundary: search and chat consider only documents attached to that
workspace.

The product is not merely a chat interface over PDFs. Its primary value is provenance:

- Preserve immutable source documents.
- Keep page numbers and spatial coordinates through ingestion.
- Retrieve both semantically similar passages and exact terms or numbers.
- Generate answers only from retrieved evidence.
- Make every material claim traceable to a page and, when possible, a highlighted region.
- Expose intermediate artifacts so extraction and retrieval failures can be diagnosed.

The initial corpus is small, but the design should remain comfortable with thousands of documents
and evolving document collections without requiring a rewrite.

## 2. Product principles

1. **Evidence before fluency.** A concise, cited answer is better than a polished unsupported answer.
2. **The original PDF is authoritative.** Extracted text and model output are derived artifacts.
3. **Page provenance is never discarded.** Chunking must retain links to source pages and bounding boxes.
4. **Search is hybrid.** Vector similarity alone is insufficient for exact numbers, units, product codes, acronyms, and defined terms.
5. **Small retrieval units, larger reading context.** Search child chunks; answer from their parent sections or neighboring chunks.
6. **Structured filters are explicit and inspectable.** Model-proposed filters must be validated against stored metadata.
7. **Keep stateful infrastructure portable.** PostgreSQL is deployed with the application, while
   durable objects live in managed S3-compatible storage. External AI providers remain optional
   adapters rather than architectural dependencies.
8. **Reproducibility matters.** Record OCR, chunker, embedding model, and prompt versions for every derived artifact.
9. **Process once, organize many ways.** A canonical document is ingested independently and may be
   attached to several workspaces without duplicating files, chunks, or embeddings.
10. **Workspace scope is enforced by the server.** The active workspace determines the eligible
    document set for search, chat, and retrieval traces; it is not merely a client-side filter.

## 3. Scope

### MVP capabilities

- Upload one or more PDFs through the web UI.
- Create, rename, and delete workspaces.
- Attach a document to one or more workspaces and detach it without deleting the canonical document.
- Compute a content hash and prevent accidental duplicate ingestion.
- Edit document metadata before or after ingestion.
- Detect pages with and without usable embedded text.
- Run OCR only where needed.
- Extract page text, text blocks, and bounding boxes.
- Build section-aware parent passages and searchable child chunks.
- Generate embeddings and store them in PostgreSQL with pgvector.
- Search the active workspace with vectors, PostgreSQL full-text search, and metadata filters.
- Ask workspace-scoped questions and receive answers with source citations.
- Open a cited PDF at the correct page; support region highlighting when coordinates are available.
- Inspect documents, pages, chunks, retrieval results, and ingestion errors.
- Re-run extraction, chunking, or embedding independently.

### Explicit non-goals for MVP

- Treating generated output as professional advice or as authoritative beyond the indexed sources.
- Internet search or knowledge outside the indexed documents.
- Multi-tenant administration, roles, sharing, and enterprise identity providers. The existing
  Better Auth session boundary remains in place even though the MVP deployment is single-user.
- Collaborative annotations.
- Automatic interpretation of charts or complex image-only diagrams.
- Perfect table reconstruction.
- Distributed job infrastructure such as Redis or Kafka.
- Approximate vector indexes before corpus size demonstrates a need.

## 4. Technology direction

Extend the existing pnpm/Turborepo monorepo rather than creating a parallel project layout. The
repository is fully ESM TypeScript, targets Node.js 24, and currently has this shape:

```text
/
├── apps/
│   ├── web/                React Router web application with SSR
│   └── api/                Hono HTTP API and future worker entrypoint
├── packages/
│   ├── auth/               Better Auth server factory and browser client
│   ├── db/                 Drizzle schema, migrations, and repositories
│   ├── env/                Zod-validated API and web environment contracts
│   ├── config/             Shared TypeScript and Vitest configuration
│   └── test-utils/         Shared fixtures and MSW handlers
├── compose.yaml
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

Build the first vertical slice inside the existing workspaces. Add schemas and repositories to
`packages/db`; add request validation, routes, orchestration, and provider-independent service
modules to `apps/api`; and add UI routes, API query definitions, and components to `apps/web`.
Extract `ingestion`, `retrieval`, or `ai` packages only when a stable boundary has multiple consumers
or the API workspace becomes difficult to navigate. The current Hono client already derives the web-facing contract from the composed API route type.

The placeholder todo feature is a structural example, not a domain constraint. Replace it
incrementally with document/search functionality while preserving its established dependency flow:

```text
apps/web -> @repo/api/client -> apps/api routes -> @repo/db repositories -> PostgreSQL
             |                     |
             +-> @repo/auth/client +-> @repo/auth and @repo/env/api
```

Only `apps/api` and `packages/auth` may depend on `packages/db`; browser and React Router SSR code
must use the Hono client and must never import database or API server modules.

### Web

- React
- React Router 8 in Framework Mode with SSR and generated route types
- TanStack Query
- Vite, Tailwind CSS 4, and the existing shadcn/ui component layer
- PDF.js for source viewing
- A restrained component layer; optimize for inspection and clarity rather than dashboard ornamentation

### API and worker

- Node.js + TypeScript
- Hono
- Zod request schemas colocated under `apps/api/src/validation` and applied with
  `@hono/zod-validator`
- Typed API consumption through the sole public server export, `@repo/api/client`
- Drizzle ORM for schema and ordinary queries
- Handwritten parameterized SQL where vector or full-text queries are clearer than ORM abstractions
- Route factories with explicit repository/service dependencies, following the existing
  `createApp` composition pattern
- A worker process built as another `apps/api` entrypoint and composed from the same repositories and
  service modules as HTTP routes

Keep the existing cross-cutting API behavior: request IDs, Pino structured logging, secure headers,
body limits, CSRF protection, centralized problem responses, graceful shutdown, and dependency
injection. Upload routes will need a configurable PDF-specific body limit rather than weakening the
global limit for every endpoint.

Suggested commands:

```text
pnpm dev                                  # all development processes through Turborepo
pnpm --filter @repo/api dev               # API only
pnpm --filter @repo/web dev               # web only
pnpm --filter @repo/api worker            # worker script to add
pnpm test | pnpm typecheck | pnpm lint
```

Root scripts should delegate to workspace scripts through Turborepo or `pnpm --filter`, consistent
with the existing database and auth commands.

### Database

Keep the existing PostgreSQL 18 service and Drizzle workflow, but change the Compose image to a
PostgreSQL 18-compatible image that includes pgvector and enable the extension in a committed Drizzle
migration. Preserve the existing `postgres` service and `postgres-18-data` volume names unless an
intentional migration is documented.

For the initial corpus, use exact cosine-distance search without HNSW or IVFFlat. Exact search has no recall loss and is fast enough for a small collection. Add an HNSW index only after measurement shows exact search is a bottleneck.

PostgreSQL also provides:

- Relational metadata filtering
- JSONB for custom metadata
- `tsvector` full-text search
- Transactions for ingestion state
- `FOR UPDATE SKIP LOCKED` for a simple database-backed job queue

### Object storage

Store PDF bytes and derived binary/text artifacts in S3-compatible object storage rather than on a
filesystem mounted directly into the application. PostgreSQL stores object keys, hashes, sizes, MIME
types, and lifecycle state; it does not store document bodies or provider-specific URLs.

Define a narrow provider-independent interface in `apps/api` initially:

```ts
interface ObjectStorage {
  put(input: PutObjectInput): Promise<StoredObject>;
  head(key: string): Promise<StoredObjectMetadata | null>;
  get(key: string, range?: ByteRange): Promise<ObjectStream>;
  list(prefix: string): AsyncIterable<StoredObjectMetadata>;
  delete(key: string): Promise<void>;
}
```

Implement it with the AWS SDK for JavaScript v3 S3 client, configured by endpoint, region, bucket,
access key, secret key, and an explicit addressing-style option. Keep the interface limited to
behavior the application actually needs; do not leak SDK response types into domain services. The
API should proxy authenticated PDF downloads and byte-range requests initially. Presigned browser
URLs are a later optimization because they complicate authorization and response headers. Add the S3
client dependency through the root pnpm catalog and consume it from `@repo/api`, consistent with the
repository's strict catalog policy.

Use opaque generated keys, never filenames:

```text
users/{userId}/documents/{documentId}/original.pdf
users/{userId}/documents/{documentId}/derivations/{derivationId}/searchable.pdf
users/{userId}/documents/{documentId}/derivations/{derivationId}/extraction.xhtml
users/{userId}/documents/{documentId}/previews/{pageNumber}.webp
```

Development and production use separate private Hetzner Object Storage buckets and separate
credentials. Hetzner endpoints are location-bound, for example
`https://fsn1.your-objectstorage.com`, and the signing region must match that location. Use
virtual-hosted bucket addressing for Hetzner (`forcePathStyle: false`). Keep endpoint and addressing
style configurable so the domain layer remains portable to another S3-compatible provider. The
browser must never receive bucket credentials or connect to the bucket directly in the MVP.

Use one consistent server-side configuration contract:

```text
S3_ENDPOINT
S3_REGION
S3_BUCKET
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
S3_FORCE_PATH_STYLE=false
```

The development and production values must name different buckets and preferably use different
Hetzner projects or access keys. Apply a bucket policy that limits each application key to its own
bucket and only the actions required by the adapter.

S3 does not provide a filesystem rename, and Hetzner documents that `CopyObject` may fail depending
on internal factors. Do not make server-side copy part of the publication protocol. Finish each upload
or derivation in a bounded worker/API temporary file, compute its SHA-256, and then upload it once to
its immutable final key. Verify the resulting object with `head`, commit the database reference, and
delete the local temporary file. A failed database transaction can leave an unreferenced final object;
a periodic reconciliation job removes such objects after a safety window and reports database
references whose objects are missing. Object deletion is idempotent and happens only after reference
checks described in the persistence model.

Final keys are write-once. Store the application-computed SHA-256 in PostgreSQL and object metadata;
do not treat an S3 ETag as a content hash because multipart and provider-specific implementations may
produce different values. Database and object storage cannot share a transaction, so publication code
must tolerate either side succeeding first and rely on idempotency plus reconciliation to converge.

### OCR and PDF tooling

The PDF toolchain is intentionally polyglot at the executable boundary. OCRmyPDF is implemented in
Python and relies on native tools, while Tesseract and Poppler are native applications. Reimplementing
them in TypeScript would add risk without improving the product. The TypeScript application owns
orchestration, persistence, retries, validation, and parsing; the worker invokes a pinned toolchain
inside its container.

#### Container runtime

Build one application image that can run either the API or worker command. A multi-stage Dockerfile
should build the Node application first, then copy its production output into a slim runtime stage
containing:

- Node.js 24
- A Python virtual environment containing a pinned OCRmyPDF version
- Tesseract plus explicitly selected language packs
- Poppler utilities for `pdfinfo`, `pdftotext`, and `pdftoppm`
- OCRmyPDF runtime dependencies such as Ghostscript and qpdf

Pin the base image by version and lock the Python package version in a small requirements file. Treat
the OS packages as part of the image release: record their versions during the build and rebuild the
image to upgrade them. Do not install Python packages or system tools when a job starts, and do not
require Python on the host. The API and worker may share the image, but only the worker should execute
the OCR tools. A separate Python service is unnecessary for the MVP because no application logic or
long-lived Python API is needed.

The worker image must run as a non-root user, have a read-only root filesystem where practical, and
receive writable space only for its bounded temporary-work directory. Durable inputs and outputs move
through `ObjectStorage`; they are not shared filesystem mounts. Production egress should be limited
to the configured Hetzner HTTPS endpoint and any explicitly enabled AI provider endpoints. Configure
container CPU and memory limits and cap the number of concurrent document jobs; Tesseract can
otherwise consume all available cores and memory.

#### TypeScript process boundary

Put a small typed adapter in the API workspace around `node:child_process.spawn`. Each supported
operation has a fixed executable and constructs its own argument array from validated options. The
generic runner must:

- Never enable a shell and never accept a complete command string from a route, filename, or metadata.
- Resolve every process input and output path beneath the job's temporary root; object keys are
  generated separately by application code.
- Set an explicit working directory and minimal environment.
- Stream stdout and stderr into bounded buffers and optional log artifacts rather than holding
  unlimited output in memory.
- Enforce a per-operation timeout, send `SIGTERM`, then escalate to `SIGKILL` after a short grace
  period.
- Propagate cancellation when a job is cancelled or the worker shuts down.
- Return a structured result containing tool name, sanitized arguments, start/end times, exit code,
  terminating signal, timeout state, and captured output references.

At worker startup, probe every required binary with its version flag and store the resulting toolchain
manifest in logs and derivation records. Readiness fails when a required executable, language pack, or
writable directory is missing. Unit tests use a fake process adapter; focused container integration
tests exercise small checked-in PDFs against the real binaries.

#### Per-document execution

Each attempt gets a fresh job-specific temporary directory. Inputs use generated internal names, not
the uploaded filename. The worker performs these steps:

1. Run `pdfinfo` and a parser-level readability check against the immutable original. Reject
   encrypted PDFs that cannot be opened and enforce page-count and size limits before expensive work.
2. Probe page text to decide whether OCR is needed. A digitally generated PDF can go directly to
   spatial extraction; mixed or image-only input goes through OCRmyPDF.
3. Run OCRmyPDF with existing text preserved, conservative rotation and deskew, optimization disabled
   unless deliberately evaluated, a configured language list, and a new temporary output path. Never
   overwrite the original.
4. Validate the derived PDF again, verify the expected page count, compute its hash, and publish it
   through `ObjectStorage` only after success.
5. Run `pdftotext -bbox-layout` against the selected searchable PDF and parse the resulting XHTML in
   TypeScript. Use `pdftoppm` only for requested previews or diagnostics rather than rendering every
   page eagerly.
6. Remove the temporary directory after success. On failure, retain only bounded diagnostic artifacts
   according to a configurable policy; database state must never point at a partial output.

Record the executable versions, normalized configuration, input/output hashes, timestamps, exit
status, and bounded logs on the corresponding `document_derivations` row. Retry only from immutable
inputs, finish and hash local files before uploading them to write-once final keys, and make every
publication stage idempotent. Tool failures must become structured job errors with a user-safe
summary and an operator-facing diagnostic, not raw stderr returned to the browser.

## 5. Deployment model

The intended experience is:

```text
docker compose up
```

This command assumes a development Hetzner bucket and its server-only configuration are already
present in the local environment. Compose does not provision, emulate, or own object storage.

Services:

```text
web      React production assets, or served by api in the minimal deployment
api      HTTP API
worker   ingestion and embedding jobs using the same application image
postgres PostgreSQL + pgvector
```

Today `compose.yaml` starts only PostgreSQL; local application processes run through `pnpm dev` at
`http://localhost:5173` (web) and `http://localhost:3001` (API). Evolve that file toward the full
four-service deployment above rather than introducing a second Compose definition. Object storage is
an external managed dependency in every environment and must not be added to Compose. In production,
route `/api/auth/*` to Hono without rewriting the path, route other `/api/*` requests to Hono with the
`/api` prefix stripped, and route all remaining requests to the React Router web service. This keeps
browser calls same-origin and matches the current Vite development proxy.

Mounted volumes:

```text
postgres     relational data, workspace membership, and embeddings
worker-temp  bounded, disposable OCR and extraction working files
```

The default Compose configuration should bind the application to localhost. Retain the existing
Better Auth email/password session flow and authenticated route boundary; new enterprise providers,
roles, user administration, and collaborative access remain out of MVP scope. Clearly warn when
binding to a non-loopback interface.

Add server configuration to `packages/env/src/api.ts` and its tests. Keep browser-visible and
server-only variables separated through the existing `@repo/env/web` and `@repo/env/api` exports.
External provider API keys are supplied only through environment variables or mounted secrets. Never
store plaintext keys in the database or browser storage.

The API and worker receive private bucket configuration through server-only environment variables or
mounted secrets. Development and production must use different buckets and credentials; local
development must never fall back to production credentials. The browser never receives these values
or connects directly to Hetzner Object Storage.

Managed object storage is durable infrastructure, not a complete backup or a transactional extension
of PostgreSQL. Enable bucket versioning with a lifecycle policy that bounds retained versions, back up
PostgreSQL independently, and document a restore procedure that reconciles database object references
against a bucket inventory. Preserve deleted object versions long enough to recover from an erroneous
database restore or application deletion. A successful disaster-recovery test must restore both sides
to a mutually consistent state.

Validate endpoint, region, bucket, access key, secret key, and addressing-style configuration in
`packages/env/src/api.ts`. Hetzner development values come from the root `.env`; production receives
them from its runtime or mounted secrets. Only endpoint and region may have documented non-secret
defaults. Bucket names and credentials are always explicit so a misconfigured environment fails
closed instead of writing to the wrong bucket.

## 6. Domain and persistence model

Names below describe the required concepts; exact SQL naming may vary.

### `workspaces`

A workspace is the user-facing organizational and retrieval boundary.

```text
id                       uuid primary key
user_id                  Better Auth user foreign key
name                     user-facing name
description              nullable text
created_at / updated_at
```

Workspace names need not be globally unique. Repository methods always scope them by authenticated
user. Deleting a workspace deletes its attachments, conversations, and workspace-scoped retrieval
history, but does not delete canonical documents or their derived artifacts.

### `workspace_documents`

This join table attaches canonical documents to workspaces and holds organization that may differ by
workspace.

```text
user_id                  Better Auth user foreign key
workspace_id             foreign key
document_id              foreign key
display_title            nullable workspace-specific override
tags                     text[]
attached_at / updated_at
primary key              workspace_id, document_id
```

A document may be attached to several workspaces without being copied or reprocessed. Detaching it
from one workspace removes only this row. `display_title` and `tags` belong here because the same
document may be organized differently in different workspaces. Canonical file properties and
processing state belong on `documents`.

Use ownership-aware foreign keys or equivalent database constraints so a workspace and document from
different users cannot be joined. Index `(user_id, workspace_id)` for scoped listing/retrieval and
`(user_id, document_id)` for attachment checks and deletion.

### `documents`

Documents are canonical user-owned source records independent of workspace membership.

```text
id                       uuid primary key
user_id                  Better Auth user foreign key
sha256                   content hash, unique per user
filename                 original filename
title                    nullable human-readable title
description              nullable text
custom_metadata          jsonb
original_object_key      private object-storage key
original_size_bytes
original_content_type
page_count               nullable integer
status                   uploaded | processing | ready | failed | deleting
created_at / updated_at
```

The application is deployed for one user initially, but document-owned rows should still be scoped
through the authenticated user at repository boundaries, as the current todo repository is. Child
records inherit access through their document; every repository lookup must enforce that ownership
rather than trusting a client-supplied document ID. A future globally deduplicated blob store would
need a separate ownership mapping and is not part of the MVP.

When an upload matches an existing `(user_id, sha256)`, reuse the canonical document and its current
processing state, discard the temporary duplicate object, and create only the requested workspace
attachment. Do not deduplicate across users in the MVP.

Keep first-class metadata deliberately small. Canonical `title`, `description`, and `custom_metadata`
describe the source itself; workspace-specific display titles and tags organize it within a research
context. `custom_metadata` provides an escape hatch for imported fields, but the first UI does not
need a schema builder. Document replacement, version graphs, and domain-specific fields can be added
after concrete usage demonstrates a need.

### `document_derivations`

Track every reproducible transformation:

```text
id
document_id
kind                     preflight | ocr | extraction | chunking | embedding
status
tool_name
tool_version
configuration            jsonb
artifact_object_key      nullable private object-storage key
input_sha256
output_sha256
started_at / completed_at
error                     jsonb
```

### `pages`

```text
id
document_id
page_number              one-based user-facing page index
pdf_label                nullable printed page label
width / height           PDF coordinate-space dimensions
text
text_sha256
extraction_method        embedded | ocr | mixed | none
quality_flags            jsonb
```

Page number always means the physical PDF page unless explicitly labeled otherwise. Preserve printed
page labels separately because documents may use their own numbering or leave introductory pages
unnumbered.

### `text_blocks`

```text
id
page_id
ordinal
x0 / y0 / x1 / y1
text
block_type
style_metadata           jsonb
```

Coordinates use the PDF page coordinate system returned by the extractor. Record page dimensions so the client can scale highlights accurately.

### `sections`

Sections are parent reading units.

```text
id
document_id
parent_section_id
heading
heading_path             text[]
ordinal
page_start / page_end
text
token_count
```

Heading detection may initially be heuristic. The inspector must allow incorrect section boundaries to be seen, and later edited or rebuilt.

### `chunks`

Chunks are child search units.

```text
id
document_id
section_id
ordinal
text
embedding_text
token_count
embedding                vector
embedding_model
embedding_dimensions
text_search              generated tsvector
chunker_version
created_at
```

Use one active embedding space per deployment. Changing model or dimensions creates an explicit re-embedding job. A dimensionless pgvector column is acceptable for the exact-search MVP if model and dimension predicates are enforced in every similarity query.

`embedding_text` may include a short contextual prefix that is not displayed as source text:

```text
Document: Employee Handbook
Section: Remote work equipment

<verbatim chunk text>
```

### `chunk_spans`

This is the provenance join between logical chunks and physical pages.

```text
id
chunk_id
page_id
ordinal
x0 / y0 / x1 / y1       nullable union box
block_ids                uuid[] or normalized join table
source_text
```

A chunk may have several spans and cross a page boundary. Citation rendering uses these records, not page numbers generated by a language model.

### `jobs`

```text
id
kind
user_id                  Better Auth user foreign key
document_id              nullable for system cleanup jobs
status                   queued | running | succeeded | failed | cancelled
attempts
configuration            jsonb
progress                  jsonb
available_at
locked_at
locked_by
error                     jsonb
created_at / updated_at
```

Claim jobs transactionally with `FOR UPDATE SKIP LOCKED`. Each stage must be idempotent and safe to retry.
Document processing jobs remain document-scoped. Storage-reconciliation and garbage-collection jobs
may have a null `document_id` after their target document has entered deletion and instead carry an
immutable object-key manifest in `configuration`.

### `conversations`, `messages`, and `retrieval_runs`

Persist questions and their evidence separately from generated answers. Every conversation belongs to
one workspace. Retrieval runs carry `user_id` and `workspace_id`; their evidence may reference only
documents attached to that workspace when the run begins. A retrieval run should record:

- Original question
- Workspace ID and the exact eligible document IDs used for the run
- Query plan and validated filters
- Embedding model and query vectors or hashes
- Vector and lexical candidates with raw ranks/scores
- Fusion and deduplication decisions
- Final chunks/parents sent as evidence
- Prompt/model configuration
- Generated answer and resolved citations

This record is essential for debugging and evaluation.

Persisting the eligible document IDs makes the trace reproducible if documents are later attached or
detached. Moving a conversation between workspaces is not supported in the MVP because it would make
the meaning of earlier messages and citations ambiguous.

### Deletion and garbage collection

Workspace deletion and document detachment never delete a canonical document. Explicit document
deletion is a separate action: block it while attachments exist, or require the user to confirm
detachment from every workspace. Mark the document as deleting and transactionally create a durable
garbage-collection job containing its object keys. The worker deletes every object idempotently, then
purges the document rows. Failed object deletion remains visible and retryable; partially completed
cleanup must not make the document searchable again.

## 7. Ingestion pipeline

Ingestion is document-scoped, never workspace-scoped. Each stage writes status and artifacts
independently, and all workspaces attached to the document observe the same processing state.

### 7.1 Upload and preflight

1. Require an authenticated destination workspace and verify that it belongs to the user.
2. Stream the upload to bounded temporary storage while computing SHA-256 and enforcing the size
   limit; never buffer the complete PDF in memory.
3. Validate that it is a readable PDF; do not trust MIME type or extension.
4. Look up the checksum within the authenticated user's canonical documents.
5. If it already exists, discard the temporary upload and idempotently create the workspace
   attachment. Reuse all completed or in-progress derivations.
6. Otherwise create the document, publish the immutable original to its final object key, attach it to
   the destination workspace, and enqueue preflight. The UI presents this as one upload action even
   though the canonical document and attachment are separate records.
7. The worker downloads the original into its job-specific temporary directory, runs `pdfinfo` and
   page-level text probes, and creates a preflight report showing page count and which pages appear
   scanned.

### 7.2 OCR

1. Create a derived searchable PDF with OCRmyPDF in skip-existing-text mode.
2. Enable conservative rotation and deskew correction.
3. Do not use destructive cleanup or background removal by default.
4. Record OCR output and logs.
5. Verify that every expected page exists and has either text or a quality warning.

The OCR output is an intermediate object. The original remains the source presented to the user unless
the OCR copy is required for highlighting. The worker downloads inputs and uploads completed outputs
through `ObjectStorage`; OCR tools operate only on job-local temporary paths.

### 7.3 Spatial text extraction

1. Run `pdftotext -bbox-layout` against the searchable PDF.
2. Parse its XHTML/XML output in TypeScript.
3. Persist page dimensions, words, lines, and blocks with coordinates.
4. Produce normalized page text while retaining verbatim block text.
5. Detect and flag empty pages, unusually low character counts, replacement characters, and implausible token patterns.
6. Identify repeated headers and footers, but mark rather than permanently delete them in the first implementation.

Normalization should be conservative:

- Normalize Unicode whitespace.
- Join line-wrapped words only when a defensible hyphenation rule applies.
- Preserve bullets, percentages, currency, dates, and defined-term capitalization.
- Never silently rewrite suspicious OCR values.

### 7.4 Section construction

Infer headings from spatial separation, line length, capitalization, and available font/layout signals. Create a document heading path when confidence is adequate. If heading inference is weak, fall back to page-scoped parent passages rather than inventing structure.

Tables and lists should remain atomic when they fit within the parent-passage limit. A heading must travel with the content it qualifies.

### 7.5 Parent and child chunking

Use structure-aware chunking rather than fixed character windows.

Parent passages:

- Target 800–1,500 tokens.
- Usually a complete subsection.
- May cross a page boundary with provenance spans for each page.
- Used as expanded answer context.

Child search chunks:

- Target 250–400 tokens.
- Minimum around 120 tokens unless the unit is a meaningful list/table.
- Hard maximum around 550 tokens.
- Prefer paragraph, list, and heading boundaries.
- Use only 40–70 tokens of overlap.
- Never overlap across unrelated sections.

These are initial defaults, not permanent truths. Store chunker configuration and measure retrieval quality against an evaluation set.

### 7.6 Embedding

Embed child chunks, not entire parent sections. Batch requests within provider limits. Store the model, dimensions, normalized configuration, and the exact `embedding_text` hash.

Provider interface:

```ts
interface EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  embed(inputs: string[]): Promise<number[][]>;
}
```

Initial adapters may include:

- OpenAI `text-embedding-3-small`
- An OpenAI-compatible local endpoint
- Ollama or a dedicated local embedding server

The ingestion pipeline must not otherwise know which provider is active.

## 8. Query and answer pipeline

### 8.1 Query planning

Do not invoke an LLM planner for every question.

The HTTP request supplies the active workspace, and the server validates ownership before planning.
`workspaceId` is trusted application context, not a model-proposed filter and not part of the planner
schema. Resolve the workspace's attached document IDs before retrieval and persist that eligible set
on the retrieval run.

Simple factual questions use the original query directly. Use decomposition when a request contains comparisons, multiple requirements, temporal distinctions, or several entities.

The planner returns validated structured output:

```ts
const QueryPlan = z.object({
  intent: z.enum(["lookup", "explain", "compare", "summarize"]),
  queries: z.array(z.string().min(1)).min(1).max(5),
  filters: z.object({
    documentIds: z.array(z.string().uuid()).optional(),
    tags: z.array(z.string()).optional(),
  }),
  requestedTopics: z.array(z.string()).default([]),
});
```

Only permit filter values that exist within the active workspace. Tags refer to
`workspace_documents.tags`, not canonical document metadata. If strict optional filters produce no
evidence, retry without those optional filters and disclose the relaxation in the retrieval trace;
never relax the workspace boundary.

### 8.2 Candidate retrieval

For each subquery:

1. Retrieve approximately 20–40 exact vector neighbors joined through `workspace_documents` and
   constrained to the active workspace.
2. Retrieve approximately 20–40 PostgreSQL full-text matches under the same workspace constraint.
3. Optionally add a literal fallback for exact phrases, numbers, units, dates, or identifiers.
4. Merge result lists using reciprocal-rank fusion.

Do not attempt to compare raw vector distance and full-text rank directly; their scales are unrelated.
Embedding input contains only canonical document context. Do not include workspace names, attachment
tags, or other workspace-specific text, because the same embedding must remain reusable wherever the
document is attached.

### 8.3 Deduplication and diversification

- Collapse duplicate chunk IDs across subqueries.
- Penalize near-identical overlapping chunks.
- Limit the number of selected children from one parent section.
- Preserve distinct evidence for each requested topic.
- Prefer direct matches over context-only neighbors.
- Consider maximal marginal relevance only after a simple deterministic policy is working and evaluated.

### 8.4 Context expansion

Select child chunks for precision, then expand each winner using one of:

- Its full parent section when it fits the remaining context budget.
- The child plus its preceding and following sibling.
- A bounded excerpt around the child when the parent is too large.

Deduplicate expanded text and target an initial total evidence budget of 3,000–6,000 tokens. Budget by evidence value rather than fixed top-N alone.

### 8.5 Answer synthesis

The answer model receives evidence records with opaque source IDs:

```text
[SOURCE c_184]
Document: Employee Handbook
Physical PDF page: 1
Section: Remote work equipment
Text: ...
```

System requirements:

- Use only supplied evidence.
- Cite each material factual claim with one or more source IDs.
- Preserve exact numbers and defined terms.
- Distinguish conflicting sources and clearly identify which document supports each claim.
- State when evidence is missing, ambiguous, or contradictory.
- Do not present generated interpretation as professional advice.
- Do not create filenames, page numbers, quotations, or citations.

The server validates cited IDs and resolves them into document/page links. Unknown citation IDs cause answer validation failure or regeneration.

Generation provider interface:

```ts
interface GenerationProvider {
  readonly id: string;
  generateStructured<T>(request: StructuredGenerationRequest<T>): Promise<T>;
  generateAnswer(request: AnswerRequest): Promise<AnswerResult>;
}
```

Use a low-cost structured-output-capable model for query planning. Start with the same inexpensive model for synthesis, then upgrade synthesis only if the evaluation set demonstrates a quality gap. Provider selection is configuration, not hard-coded business logic.

## 9. API shape

Exact paths may evolve, but preserve these resource boundaries. These are Hono service paths. Browser
and SSR callers reach non-auth routes through the same-origin `/api` proxy (for example,
`/api/documents` maps to Hono `/documents`); Better Auth remains mounted at Hono
`/api/auth/*` without a rewrite.

```text
POST   /workspaces                        create workspace
GET    /workspaces                        list workspaces
GET    /workspaces/:id                    workspace details
PATCH  /workspaces/:id                    update workspace
DELETE /workspaces/:id                    delete workspace, not canonical documents
GET    /workspaces/:id/documents          list attached documents
POST   /workspaces/:id/documents          upload PDF and attach or reuse canonical document
PUT    /workspaces/:id/documents/:docId   attach an existing document idempotently
PATCH  /workspaces/:id/documents/:docId   update attachment display title or tags
DELETE /workspaces/:id/documents/:docId   detach without deleting document
POST   /workspaces/:id/search             workspace-scoped retrieval without generation
POST   /workspaces/:id/ask                workspace-scoped retrieval plus cited answer
GET    /workspaces/:id/conversations      list workspace conversations
POST   /workspaces/:id/conversations      create workspace conversation
GET    /documents                         list the user's canonical document library
GET    /documents/:id                     document and ingestion status
PATCH  /documents/:id                     update metadata
DELETE /documents/:id                     explicitly delete an unattached canonical document
POST   /documents/:id/ingest              enqueue full ingestion
POST   /documents/:id/reextract           rerun extraction and downstream stages
POST   /documents/:id/rechunk             rerun chunking and embeddings
GET    /documents/:id/pages/:number       page text and blocks
GET    /documents/:id/file                stream original PDF with range support
GET    /documents/:id/chunks               inspect chunks
GET    /jobs/:id                           job state and progress
GET    /retrieval-runs/:id                 complete retrieval trace
```

Uploading through a workspace is the primary web flow. The route hashes the upload, reuses an existing
canonical document when possible, and creates the attachment, so users do not have to understand the
internal two-layer model. Canonical document routes exist for inspection, reprocessing, reuse, and
explicit deletion. Workspace IDs on search and chat routes are mandatory resource boundaries, not
optional filters.

Define strict Zod request schemas under `apps/api/src/validation`, attach them with `zValidator`, and
return JSON from chained Hono route factories so `AppType` retains the complete contract. Export only
the client factory and inferred `ApiClient` from `@repo/api/client`; the web application must never
import database types or API server modules directly.

In `apps/web`, derive query and mutation input types from `ApiClient`, group TanStack Query options
and keys by resource under `app/queries`, use the relative client in the browser, and forward cookies
through the server client during SSR. Use the existing `ApiError` and problem-details error path for
validation and domain failures.

For long-running ingestion, return `202 Accepted` with a job ID. The web client can poll through TanStack Query initially; server-sent events may be added later.

## 10. Web experience

### Workspaces

- Workspace switcher and workspace creation flow
- Name, description, document count, and recent activity
- Workspace-scoped document list, search, and conversations
- Attach an existing canonical document without re-uploading or reprocessing it
- Detach with clear language that the underlying document is retained
- Delete with clear language that attached documents remain available elsewhere

### Documents

- Upload drop zone and file picker within the active workspace
- Duplicate detection that reuses the existing document and creates the new attachment
- Canonical metadata editor plus separate workspace display-title and tag controls
- Ingestion status and stage progress
- Reprocess controls
- Clear quality warnings

### Document inspector

Three synchronized panes are ideal:

1. PDF page viewer
2. Extracted blocks/chunks and metadata
3. Ingestion log and quality flags

Selecting a chunk highlights all associated page spans. Selecting PDF text should reveal the owning block/chunk where possible.

### Search

Show ranked chunks from the active workspace without invoking answer generation:

- Combined rank
- Vector rank
- Full-text rank
- Document metadata
- Section and page
- Matched excerpt
- Link to retrieval trace

This is a first-class debugging and research feature, not an admin afterthought.

### Ask

- Natural-language question input
- Persistent indication of the active workspace and eligible document count
- Optional visible metadata filters
- Cited synthesized answer
- Expandable source cards containing verbatim excerpts
- Open-at-page action
- Highlight source region when available
- Clear warning when sources conflict or do not establish an answer

## 11. Quality and evaluation

Create a checked-in evaluation dataset that contains questions but no confidential document text. Local expected-answer files may remain git-ignored.

Each evaluation case should record:

```yaml
workspace: workplace-policies
question: What equipment is provided for remote work?
expected_documents:
  - employee_handbook.pdf
expected_pages: [18, 19]
required_concepts:
  - laptop
  - external monitor
forbidden_claims: []
```

Measure separately:

- OCR/extraction coverage by page
- Citation/page recall
- Retrieval hit rate at K
- Required-concept coverage
- Unsupported-claim rate
- Exact-number accuracy
- Latency by pipeline stage

Maintain a small adversarial set:

- A relevant document owned by the user but not attached to the active workspace
- One canonical document attached to two workspaces with different tags
- Similar language in unrelated documents
- Conflicting revisions of the same material
- Question whose answer is absent
- Conflicting source documents
- Exact number, unit, date, or identifier
- Defined term with a common-language meaning
- Question requiring two sections
- OCR corruption near a critical number

Never tune chunking solely by whether generated answers sound good. Inspect whether the expected evidence was retrieved.

Follow the repository's existing verification stack: colocated Vitest tests for API, schema,
repository, environment, and pure pipeline behavior; shared MSW handlers and fixtures in
`packages/test-utils`; React Testing Library for component behavior; and Playwright in `apps/web` for
critical browser flows. Keep `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `pnpm test`
passing through Turborepo. Add hermetic fakes for OCR and AI provider boundaries so routine tests do
not require installed executables, network access, or paid credentials.

Add repository tests proving workspace isolation, cross-user attachment rejection, idempotent
attachment, checksum reuse, and safe detach/delete behavior. Keep routine object-storage tests
hermetic behind an in-memory fake. Also provide an explicitly enabled adapter contract suite that
runs against a dedicated Hetzner development/test bucket and isolated key prefix to verify streaming,
metadata, byte ranges, direct-to-final publication, listing, and idempotent deletion. The suite must
refuse production-looking configuration and clean up only the prefix it created.

## 12. Security and safety

- Treat PDFs, filenames, metadata, and extracted text as untrusted input.
- Require the existing Better Auth middleware on every workspace, document, job, search, ask, and
  retrieval-run route, and enforce ownership again in repository queries.
- Verify workspace ownership and document attachment in the same repository query that selects search
  candidates; never fetch globally and filter in application memory.
- Enforce configurable upload and page-count limits.
- Store files outside publicly served directories.
- Keep the object-store bucket private, validate every object key, and never accept a complete key or
  bucket name from the browser.
- Never execute user-controlled filenames or OCR arguments.
- Run OCR subprocesses with timeouts and resource limits.
- Use parameterized SQL.
- Sanitize displayed extracted text as ordinary untrusted content.
- Prevent prompt instructions found inside documents from overriding the answer policy.
- Do not log provider API keys or complete embeddings.
- Do not log object-store secrets or return internal endpoints and object keys to the browser.
- Provide explicit document deletion that removes database rows and stored artifacts.
- Enable bounded object version retention, back up PostgreSQL independently, and test reconciliation
  as part of restoring both stores.

## 13. Observability

Extend the existing Pino logger and request-ID middleware with workspace, job, document, and
retrieval-run IDs.
Record stage durations and external process exit information. The UI should expose actionable errors
while keeping raw logs available for diagnosis.

Minimum health endpoints:

```text
/health/live
/health/ready
```

The current `/health` route is a liveness-only starting point. Preserve it as a compatibility alias
or replace it deliberately when the split live/readiness routes are introduced.

API readiness checks the database, required extensions, and private object-store bucket. Worker
health and heartbeat data report the OCR toolchain manifest, language packs, and job-claiming status
separately; missing OCR tools must not make document browsing or search unavailable. AI provider
availability is also reported separately so document inspection and non-generative search remain
usable during provider outages.

## 14. Delivery sequence

### Milestone 1 — Repository and persistence

- Replace the placeholder todo surface with the first authenticated workspace/document vertical slice
- Switch the existing PostgreSQL 18 Compose service to a pgvector-enabled image
- Configure separate Hetzner development and production buckets, implement the S3-compatible
  object-storage adapter, and add the opt-in Hetzner contract test
- Add pgvector, workspace, workspace-document, document, derivation, and job tables through the
  existing Drizzle migration workflow
- Add workspace/document repositories in `packages/db` and inject them through `apps/api/src/app.ts`
- Workspace creation, document upload, checksum reuse, object storage, attachment, and detachment
- Typed Hono workspace/document routes and matching TanStack Query definitions/UI routes
- Database-backed jobs and worker heartbeat

Exit condition: a PDF uploaded inside a workspace is stored immutably in object storage, attached to
that workspace, and visible with a durable job record. Uploading the same PDF to a second workspace
reuses the canonical document and processing state.

### Milestone 2 — OCR and provenance extraction

- PDF preflight
- OCRmyPDF integration
- `pdftotext -bbox-layout` parser
- Pages and text blocks persisted with coordinates
- Document inspector with PDF/page/block synchronization
- Quality warnings and retry behavior

Exit condition: a small representative fixture set spanning digitally generated, mixed-text,
image-only, multi-column, and rotated PDFs produces inspectable page text; selecting a block opens its
source page.

### Milestone 3 — Chunking and retrieval

- Section inference
- Parent/child chunking
- Embedding provider abstraction and one working adapter
- Exact pgvector search
- PostgreSQL full-text search
- Reciprocal-rank fusion and deduplication
- Search inspector and retrieval-run persistence

Exit condition: known questions retrieve the expected document and page in the top results without
answer generation, and isolation tests prove that identical queries cannot retrieve a user-owned
document from a workspace where it is not attached.

### Milestone 4 — Cited answers

- Query planner with decomposition gate
- Filter validation and fallback
- Context expansion and budgeting
- Generation provider abstraction
- Citation validation and source cards
- Initial evaluation suite

Exit condition: answers cite only supplied sources, citations open the correct PDF pages, and absent-answer questions are declined appropriately.

### Milestone 5 — Hardening

- Reindex/reprocess controls
- Deletion and backup documentation
- Failure recovery and job leases
- Resource limits
- Performance baselines
- Packaging and clean-machine deployment test
- Object-store reconciliation, document garbage collection, and joint database/object backup restore
  test
- Preserve the repository-wide Node 24, pnpm 11, Turborepo, strict TypeScript, Oxlint/Oxfmt,
  Vitest, and Playwright checks

Exit condition: `docker compose up` on a clean supported host with documented Hetzner development
credentials produces a usable application, and the database/object restore procedure passes against
non-production infrastructure.

## 15. MVP acceptance criteria

The MVP is complete when all of the following are true:

1. The representative PDF fixture set can be uploaded and ingested without modifying the originals.
2. A document can be attached to several workspaces without duplicating its stored objects, chunks, or
   embeddings.
3. Detaching or deleting a workspace does not delete a canonical document still used elsewhere.
4. Search and chat never return evidence from documents outside the active workspace.
5. Retrieval runs preserve the workspace and exact eligible document set used at execution time.
6. Image-only and mixed PDFs receive searchable text through OCR.
7. Every stored chunk links to at least one physical PDF page.
8. Most chunks also link to one or more valid source bounding boxes.
9. The UI can display the verbatim chunk and open the source page through authenticated range requests.
10. Workspace metadata filters can constrain retrieval by attached document and tags.
11. Search combines semantic and exact-term retrieval.
12. Parent expansion supplies surrounding qualifications without flooding context with overlapping chunks.
13. Generated answers contain validated citations for material claims.
14. The system says that evidence is insufficient when no relevant source is retrieved.
15. A retrieval trace explains why each source was selected.
16. Re-running ingestion is idempotent and recoverable after worker interruption.
17. A documented deployment requires Docker Compose, dedicated Hetzner Object Storage credentials,
    and optional external AI credentials; development and production storage configuration cannot be
    confused silently.

## 16. Decisions intentionally deferred

- SQLite distribution mode
- HNSW index thresholds and tuning
- Additional authentication methods, multi-user administration, roles, and sharing
- Rich manual correction of OCR text
- Automated table-specific extraction
- Cross-encoder reranking
- Fully local default generation model
- Workspace sharing and cross-user document attachment
- Mobile-specific UI

Resolve these through measured need, not speculative abstraction.

## 17. First implementation instruction

Begin with Milestone 1 and a vertical slice through one digitally searchable PDF. Preserve the
existing monorepo layout and replace the todo example incrementally: add the Drizzle schema and
repository exports in `packages/db`, the S3-compatible storage adapter and validated authenticated
routes in `apps/api`, and typed client queries and React Router screens in `apps/web`. Establish
workspace creation, upload-to-workspace, canonical document reuse, attachment/detachment, object
storage, job lifecycle, and page inspection before adding AI calls. Prove that the same processed PDF
can be searched from two workspaces without duplicate ingestion, while an unattached workspace cannot
retrieve it. Then add one mixed-text PDF and one image-only PDF to force the OCR boundary. Do not begin
answer synthesis until workspace-scoped retrieval can consistently surface the expected page for a
small, varied, hand-authored question set.
