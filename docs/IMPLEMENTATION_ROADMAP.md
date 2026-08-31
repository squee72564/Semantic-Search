# Semantic Document Search — Implementation Roadmap

Status: not started  
Authority: [North Star](./NORTHSTAR.md)  
Scope: MVP implementation

## How to use this roadmap

The [North Star](./NORTHSTAR.md) defines the product behavior, architecture, domain model, and quality
bar. This roadmap translates that design into dependency-ordered implementation work. If the two
documents disagree, update the North Star first and then bring this roadmap back into alignment.

Checkboxes track committed MVP work:

- `[ ]` not complete
- `[x]` complete and verified

A stage is complete only when every task and verification item in that stage is checked and its exit
gate is satisfied. Do not mark partial implementation complete. Work within a stage may be split into
smaller issues or commits, but later stages must not bypass an unmet dependency or exit gate.

## Current baseline

The repository currently provides the application skeleton rather than document-search functionality:

- A Node.js 24, pnpm, and Turborepo monorepo.
- A React Router SSR web application with TanStack Query and an authenticated layout.
- A Hono API with Better Auth, request IDs, structured logging, security middleware, and problem responses.
- PostgreSQL 18 with pgvector enabled through Drizzle migrations, repository injection, and an
  authenticated todo example.
- Shared environment validation, test configuration, fixtures, and browser-test infrastructure.
- A bootstrapped S3-compatible object-storage package and validated API storage configuration, without
  the provider-neutral object operations implemented yet.
- No document domain, complete Hetzner adapter, ingestion worker, PDF processing, retrieval, or
  answer-generation implementation.

Preserve the todo example until a workspace/document vertical slice replaces each behavior it
demonstrates. Avoid a large preliminary deletion that leaves the application without a working
authenticated reference flow.

## Runtime and package boundaries

Treat independently executed code as applications and reusable code as packages:

```text
apps/web       browser and React Router SSR runtime
apps/api       authenticated HTTP runtime and job producer
apps/worker    durable ingestion runtime and job consumer

packages/auth                 authentication factory and browser client
packages/db                   schema, migrations, repositories, and PostgreSQL job implementation
packages/env                  separate web, API, and worker environment contracts
packages/object-storage       provider-neutral object-storage contract and S3-compatible adapter
packages/document-processing  PDF/OCR/extraction behavior when that reusable boundary is introduced
packages/embeddings           embedding-provider contract and adapter when embeddings are introduced
```

PostgreSQL, S3-compatible object storage, and embedding providers are external infrastructure, not
application workspaces. Each runtime creates and closes its own database, object-storage, and provider
clients through package factories; processes never share in-memory clients or global singletons.

Keep dependency direction explicit:

- Applications may import packages; packages must not import applications, and applications must not
  import one another.
- Application entrypoints are thin composition roots that validate their own environment, translate it
  into package configuration, create resources, inject narrow dependencies, and own shutdown.
- Except for `@repo/env`, packages do not read `process.env`; they accept typed configuration and other
  required dependencies through factories.
- Provider SDK types do not escape adapter packages into domain services or application routes.
- Add a package only when code is reused, independently testable, or hides an external provider. Keep
  application-specific orchestration in its application until a genuine shared boundary appears.

The API and worker do not call each other through a business REST API. PostgreSQL is the durable
control plane: the API produces jobs, the worker consumes them, and both observe status through job
rows. S3-compatible storage is the data plane for original and derived bytes, not a signaling system.
Jobs carry typed job names and database identifiers, never credentials, bucket names, complete URLs,
arbitrary object keys, filenames, shell commands, or other executable instructions.

Keep the shared runtime contracts narrow:

```ts
interface JobProducer {
  enqueue(input: EnqueueJobInput): Promise<Job>;
  getStatus(jobId: string): Promise<JobStatus | null>;
  requestCancellation(jobId: string): Promise<boolean>;
}

interface JobConsumer {
  claim(input: ClaimJobInput): Promise<ClaimedJob | null>;
  heartbeat(input: HeartbeatInput): Promise<boolean>;
  reportProgress(input: ProgressInput): Promise<boolean>;
  complete(input: CompleteJobInput): Promise<boolean>;
  fail(input: FailJobInput): Promise<boolean>;
}

interface ObjectStorage {
  put(input: PutObjectInput): Promise<StoredObject>;
  head(key: string): Promise<StoredObjectMetadata | null>;
  get(key: string, range?: ByteRange): Promise<ObjectStream>;
  list(prefix: string): AsyncIterable<StoredObjectMetadata>;
  delete(key: string): Promise<void>;
  close(): void;
}
```

The API needs object upload, metadata, authenticated reads, and guarded deletion. The worker needs to
read originals and write, verify, list, and reconcile derived artifacts. Each runtime creates its own
adapter instance and should eventually use separately scoped database and object-storage credentials;
development may begin with one dedicated non-production credential set.

The initial queue is PostgreSQL-backed. Claim work with short `FOR UPDATE SKIP LOCKED` transactions,
commit the claim before processing, and use worker identities, leases, heartbeats, retries, cancellation,
and idempotent terminal transitions. Poll adaptively with idle backoff and jitter. PostgreSQL
`LISTEN/NOTIFY` may later reduce wake-up latency, but notifications are only hints and job rows remain
authoritative. Do not add Redis, a message broker, or a separate queue service until measured throughput,
routing, or deployment requirements justify the extra infrastructure and dual-write coordination.

## Stage 1 — Foundation and runtime configuration

**Goal:** Establish the runtime, storage, database, and fixture foundations needed by every later
vertical slice.

**North Star references:** [Technology direction](./NORTHSTAR.md#4-technology-direction),
[Database](./NORTHSTAR.md#database), [Object storage](./NORTHSTAR.md#object-storage),
[Deployment model](./NORTHSTAR.md#5-deployment-model), and
[Security and safety](./NORTHSTAR.md#12-security-and-safety).

**Dependencies:** Current repository baseline only.

### Work

- [x] Record a passing baseline for `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `pnpm test` before domain changes begin.
  - All tests, format, and lint pass
- [x] Change the existing PostgreSQL 18 Compose service to a PostgreSQL 18 image containing pgvector, preserving the `postgres` service and `postgres-18-data` volume names.
  - Changed compose to use pgvector image with pinned version - everything else stayed same & migrations run
- [x] Add a committed Drizzle migration that enables the `vector` extension and a database test that proves the extension is available.
  - Created custom migration to enable vector extension
- [x] Add the AWS SDK S3 dependency through the root pnpm catalog; do not expose it to the web workspace.
  - Created the separate `@repo/object-storage` package.
  - Added AWS SDK v3 through the root pnpm catalog and lockfile without exposing it to the web workspace.
  - Bootstrapped the typed configuration, resource factory, lifecycle, and factory tests; Stage 3 replaces
    the provisional exposed SDK client with the provider-neutral adapter contract.
- [x] Extend `@repo/env/api` with the North Star's `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and `S3_FORCE_PATH_STYLE` contract.
  - updated api env with six required s3 variables
  - updated .env and .env.example
- [x] Require explicit bucket names and credentials, default `S3_FORCE_PATH_STYLE` to `false`, and test that incomplete or malformed storage configuration fails startup.
- [x] Add distinct development and production configuration documentation. Development must use a
      non-production bucket and credentials; no environment may silently fall back to production.
- [x] Add an independently deployable `apps/worker` workspace rather than nesting the worker entrypoint
      in `apps/api`. Keep both applications as thin composition roots over shared `packages/*` modules,
      and build independently runnable API and worker images from the same repository revision.
- [x] Add a dedicated `@repo/env/worker` configuration surface so the worker does not require API-only
      secrets and the API does not receive worker-only settings. Run both images as non-root, and give
      only the worker bounded disposable scratch space.
- [x] Enforce workspace dependency boundaries: applications import packages but not other applications,
      and runtime-agnostic packages accept typed factory configuration rather than reading `process.env`.
- [ ] Add representative, license-safe PDF fixtures covering digital text, mixed text/images,
      image-only pages, multiple columns, and rotation. Keep routine tests independent of network and
      paid-provider credentials.

### Verification

- [x] A clean database migration enables pgvector without manual SQL.
- [x] Environment tests cover valid Hetzner settings, missing secrets, malformed endpoints, invalid
      regions, and development/production separation.
- [x] API and worker containers build and start independently from their respective application images;
      the API image excludes worker-only OCR, PDF-processing, and embedding dependencies.
- [x] The worker container runs as non-root with a read-only root filesystem and a size-limited,
      disposable scratch mount.
- [x] The repository-wide typecheck, lint, formatting, and test commands pass.

**Exit gate:** The application starts against pgvector-enabled PostgreSQL, validates a dedicated
Hetzner development configuration, and has stable fixtures and worker runtime boundaries for the next
vertical slice.

## Stage 2 — Workspace vertical slice

**Goal:** Replace the first part of the todo example with the authenticated organizational boundary
used by every document and retrieval operation.

**North Star references:** [Workspaces](./NORTHSTAR.md#workspaces),
[API shape](./NORTHSTAR.md#9-api-shape), and [Web workspaces](./NORTHSTAR.md#workspaces-1).

**Dependencies:** Stage 1.

### Work

- [x] Add the `workspaces` schema, migration, relations, indexes, and inferred database types.
- [x] Implement a workspace repository whose create, read, update, and delete operations always take
      the authenticated user ID and enforce ownership in the database query.
- [x] Add strict Zod validation and authenticated Hono routes for creating, listing, reading, renaming,
      and deleting workspaces.
- [x] Inject the repository through the existing `createApp` composition pattern and preserve the
      Hono-derived `AppType` contract.
- [x] Add workspace TanStack Query keys/options and mutations using only `@repo/api/client` types.
- [x] Add an authenticated, URL-scoped workspace directory, creation flow, details view, rename action,
      and deletion confirmation. Workspace identity comes from the URL; no global switcher state is used.

### Verification

- [x] Repository tests prove cross-user reads, updates, and deletes fail without leaking existence.
- [x] Validation and route tests cover invalid input, authentication failure, not found, and successful CRUD.
- [x] Component tests cover workspace listing, creation, URL navigation, renaming, deletion, errors,
      pagination, dashboard previews, and nested sidebar state.
- [x] Browser tests cover workspace CRUD and session preservation.
- [x] Existing security middleware and problem-response tests remain passing.

**Exit gate:** An authenticated user can create, list, open, rename, and delete only their own
workspaces through the web interface.

## Stage 3 — Canonical documents, attachments, and object storage

**Goal:** Deliver the first complete PDF upload flow while separating canonical processing from
workspace organization.

**North Star references:** [Object storage](./NORTHSTAR.md#object-storage),
[Domain and persistence model](./NORTHSTAR.md#6-domain-and-persistence-model),
[Upload and preflight](./NORTHSTAR.md#71-upload-and-preflight),
[API shape](./NORTHSTAR.md#9-api-shape), and [Documents](./NORTHSTAR.md#documents-1).

**Dependencies:** Stage 2.

### Work

- [ ] Add the `documents`, `workspace_documents`, and initial `jobs` tables, ownership-aware keys,
      status enums, indexes, relations, and migration.
- [ ] Define separate `JobProducer` and `JobConsumer` capabilities beside the initial PostgreSQL job
      implementation in `@repo/db`. The API receives enqueue/status/cancellation operations; the worker
      receives claim/heartbeat/progress/completion/failure operations. Do not inject one oversized queue
      interface into both runtimes or create a separate `@repo/jobs` package until another implementation
      or substantial provider-neutral state machine justifies it.
- [x] Implement the narrow `ObjectStorage` interface from the North Star with an AWS SDK v3 adapter;
      SDK types must not escape the adapter. Both applications create independent adapter instances, and
      injection sites may use narrower `Pick<ObjectStorage, ...>` capabilities where useful without
      multiplying packages.
- [x] Implement `put`, `head`, ranged `get`, prefix `list`, and idempotent `delete` against private
      virtual-hosted Hetzner buckets.
- [x] Add an opt-in contract suite using dedicated test credentials and a random isolated prefix. It
      must refuse production configuration and delete only objects created by that test run.
- [x] Implement repositories for canonical document metadata and idempotent workspace attachments,
      including cross-user attachment rejection and workspace-specific display title/tags.
- [ ] Implement authenticated streaming upload to bounded temporary storage with size enforcement,
      PDF signature/readability validation, and incremental SHA-256 calculation.
- [ ] On checksum reuse, delete the temporary file and attach the existing user-owned document without
      uploading or enqueueing duplicate work. Never deduplicate across users.
- [ ] For a new document, allocate opaque final keys, upload the completed file directly to the final
      key, verify it with `HEAD`, commit its database reference, attachment, and preflight job in one
      database transaction. Pass only the document/job identifiers to the worker.
- [ ] Add reconciliation-safe handling for an uploaded object whose database transaction fails; do
      not depend on `CopyObject`, S3 rename, or ETags as content hashes.
- [ ] Configure API and worker storage independently so production can grant least-privilege credentials
      to each runtime rather than sharing one unrestricted key.
- [ ] Add document-library and workspace-document endpoints for listing, attaching, editing attachment
      metadata, detaching, and reading document status.
- [ ] Add authenticated original-PDF streaming with HTTP byte-range support. The browser receives
      neither storage credentials nor internal object keys.
- [ ] Build the workspace upload UI, canonical library view, attachment controls, duplicate-reuse
      feedback, status display, and original-PDF opening flow.

### Verification

- [ ] Adapter contract tests prove streaming, metadata, byte ranges, listing, and idempotent deletion.
- [ ] Dependency tests or workspace checks prove neither the browser workspace nor its bundle contains
      the S3 SDK, server credentials, job-consumer operations, or worker-only dependencies.
- [ ] Upload tests prove files are not buffered wholly in memory and invalid/oversized inputs leave no
      searchable document or attachment.
- [ ] Uploading identical bytes twice for one user creates one canonical document and one stored original.
- [ ] Attaching that document to two workspaces creates two attachment rows without duplicating bytes.
- [ ] Detaching from one workspace leaves the canonical document and other attachment intact.
- [ ] Cross-user document IDs cannot be attached, inspected, streamed, or inferred.

**Exit gate:** A PDF uploaded inside a workspace is stored immutably in Hetzner, attached to that
workspace, visible with a durable job record, and reusable in another workspace without duplicate
storage or processing.

## Stage 4 — Durable worker and PDF preflight

**Goal:** Establish reliable asynchronous processing before introducing expensive OCR and extraction.

**North Star references:** [API and worker](./NORTHSTAR.md#api-and-worker),
[OCR and PDF tooling](./NORTHSTAR.md#ocr-and-pdf-tooling), [Jobs](./NORTHSTAR.md#jobs), and
[Upload and preflight](./NORTHSTAR.md#71-upload-and-preflight).

**Dependencies:** Stage 3.

### Work

- [ ] Make `apps/worker` a thin composition root over `@repo/env/worker`, `@repo/db`,
      `@repo/object-storage`, and the document-processing boundary. It must not import `apps/api`, start
      the Hono application, or require authentication and other API-only configuration.
- [ ] Implement the worker as a headless queue consumer. Do not add a business REST interface between
      API and worker; expose only separate operational liveness/readiness behavior or persisted heartbeat
      data needed by deployment monitoring.
- [ ] Implement transactional job claiming with `FOR UPDATE SKIP LOCKED`, worker identity, leases,
      bounded attempts, availability times, cancellation, and idempotent terminal transitions. Keep the
      claim transaction short and perform PDF, object-storage, and provider work after it commits.
- [ ] Implement adaptive database polling: immediately claim again while work exists, back off with jitter
      while idle, and recover expired leases. Treat optional `LISTEN/NOTIFY` only as a wake-up optimization;
      correctness must depend solely on durable job rows.
- [ ] Add worker heartbeat and progress persistence plus polling through the existing job endpoint.
- [ ] Implement a typed `spawn` adapter with fixed executables, validated argument arrays, no shell,
      timeouts, cancellation, bounded output capture, and structured results.
- [ ] Build the pinned Node, OCRmyPDF, Tesseract language-pack, Poppler, Ghostscript, and qpdf runtime.
- [ ] Probe and log the complete toolchain manifest at worker startup; readiness must fail when a
      required executable, language pack, or scratch directory is unavailable.
- [ ] Download originals through `ObjectStorage` into fresh job directories and use generated local
      filenames rather than uploaded names.
- [ ] Implement preflight with `pdfinfo` and parser-level checks, enforcing configured byte/page limits,
      rejecting unreadable or unsupported encrypted PDFs, and classifying page text availability.
- [ ] Persist the preflight derivation, page count, page classifications, normalized configuration,
      tool versions, hashes, timings, bounded diagnostics, and user-safe errors.
- [ ] Remove successful scratch directories and retain only explicitly bounded diagnostics after failure.

### Verification

- [ ] Concurrency tests prove two workers cannot claim the same job simultaneously.
- [ ] Lease-expiry and process-interruption tests prove abandoned jobs become retryable.
- [ ] Queue tests prove a missed notification or worker restart cannot lose durable work, processing never
      holds a claim transaction open, and duplicate delivery converges through idempotent handlers.
- [ ] Unit tests use a fake process adapter and cover timeout, cancellation, signals, and bounded logs.
- [ ] Container integration tests run real preflight tools against the checked-in fixtures.
- [ ] API readiness and worker/toolchain health are reported separately.

**Exit gate:** Every new canonical PDF is processed by a durable, restart-safe worker and receives an
inspectable preflight report without affecting API availability.

## Stage 5 — OCR, spatial extraction, and document inspection

**Goal:** Produce searchable text and physical-page provenance for digital, mixed, and scanned PDFs.

**North Star references:** [OCR](./NORTHSTAR.md#72-ocr),
[Spatial text extraction](./NORTHSTAR.md#73-spatial-text-extraction),
[Pages](./NORTHSTAR.md#pages), [Text blocks](./NORTHSTAR.md#text_blocks), and
[Document inspector](./NORTHSTAR.md#document-inspector).

**Dependencies:** Stage 4.

### Work

- [ ] Add `document_derivations`, `pages`, and `text_blocks` schema, indexes, relations, and migration.
- [ ] Implement stage-level job progression so extraction can retry independently from upload/preflight.
- [ ] Send digitally generated PDFs directly to extraction and run mixed/image-only inputs through
      OCRmyPDF with existing text preserved and conservative rotation/deskew defaults.
- [ ] Never overwrite the original. Validate every searchable derivative, preserve page count, hash it,
      upload it directly to a write-once final key, verify with `HEAD`, and persist its derivation.
- [ ] Run `pdftotext -bbox-layout`, parse its XHTML in TypeScript, and persist one-based physical page
      numbers, page dimensions, normalized text, verbatim blocks, and PDF-coordinate bounding boxes.
- [ ] Apply only the conservative normalization rules in the North Star and record empty/low-text,
      replacement-character, suspicious-token, repeated-header, and repeated-footer quality flags.
- [ ] Add authenticated page/block endpoints and expose derivation status, toolchain data, warnings,
      and safe failure details.
- [ ] Build the initial PDF.js inspector with synchronized page navigation and extracted block display;
      selecting a block must open and highlight its physical source page.

### Verification

- [ ] Digital fixtures skip unnecessary OCR while mixed and image-only fixtures receive OCR text.
- [ ] Original object hashes remain unchanged after every processing path.
- [ ] Digital, mixed, image-only, multi-column, and rotated fixtures preserve page counts and yield
      inspectable page/block output or explicit quality warnings.
- [ ] Stored bounding boxes remain within page dimensions and scale correctly in the viewer.
- [ ] Failed OCR/extraction never publishes partial artifacts or advances the document to ready.

**Exit gate:** The representative fixture set produces inspectable text with physical-page provenance,
and selecting extracted content opens the correct source page and region.

## Stage 6 — Sections, chunks, and embeddings

**Goal:** Convert extracted provenance into reusable parent reading units and precise searchable chunks.

**North Star references:** [Sections](./NORTHSTAR.md#sections), [Chunks](./NORTHSTAR.md#chunks),
[Chunk spans](./NORTHSTAR.md#chunk_spans), [Section construction](./NORTHSTAR.md#74-section-construction),
[Parent and child chunking](./NORTHSTAR.md#75-parent-and-child-chunking), and
[Embedding](./NORTHSTAR.md#76-embedding).

**Dependencies:** Stage 5.

### Work

- [ ] Add `sections`, `chunks`, and `chunk_spans` schema, provenance constraints, indexes, and migration.
- [ ] Implement deterministic section inference from extracted layout signals, falling back to
      page-scoped parents when heading confidence is insufficient.
- [ ] Implement structure-aware parent passages and child chunks using the North Star defaults,
      preserving headings, lists, tables, page crossings, and bounded overlap.
- [ ] Map every chunk back to ordered page/block spans and store verbatim `source_text` separately from
      contextual `embedding_text`.
- [ ] Version chunker configuration and make rechunking replace downstream chunks/embeddings only after
      a complete new derivation succeeds.
- [ ] Implement the `EmbeddingProvider` interface and one configured adapter, with batching, dimension
      validation, retry classification, model/configuration recording, and exact input hashes.
- [ ] Place the provider-neutral embedding contract and provider adapter in `@repo/embeddings` when this
      boundary is introduced. Only `apps/worker` receives provider credentials and composes the adapter;
      the API and web workspaces must not import provider SDKs or worker orchestration.
- [ ] Enforce one active embedding space per deployment and require an explicit re-embedding job when
      model or dimensions change.
- [ ] Extend the inspector to display sections, children, token counts, embedding metadata, and all
      page spans for a selected chunk.

### Verification

- [ ] Chunker unit fixtures cover headings, paragraphs, lists, tables, page boundaries, minimum/maximum
      sizes, overlap, and page-scoped fallback.
- [ ] Every chunk links to at least one physical page and every non-null bounding box is valid.
- [ ] Displayed source text remains verbatim even when embedding text contains contextual prefixes.
- [ ] Routine tests use a deterministic fake embedding provider; provider contract tests are explicit.
- [ ] Rechunking and re-embedding are idempotent and never mix incompatible embedding dimensions.

**Exit gate:** Every ready document has reproducible parent/child structure, valid source spans, and
queryable embeddings without losing the original source wording.

## Stage 7 — Workspace-scoped hybrid retrieval

**Goal:** Make trustworthy search useful before adding answer generation.

**North Star references:** [Candidate retrieval](./NORTHSTAR.md#82-candidate-retrieval),
[Deduplication and diversification](./NORTHSTAR.md#83-deduplication-and-diversification),
[Context expansion](./NORTHSTAR.md#84-context-expansion), [Search](./NORTHSTAR.md#search), and
[Quality and evaluation](./NORTHSTAR.md#11-quality-and-evaluation).

**Dependencies:** Stage 6.

### Work

- [ ] Add retrieval-run persistence for the authenticated user, active workspace, exact eligible
      document set, query inputs, candidate ranks/scores, fusion decisions, and final evidence.
- [ ] Implement exact cosine-distance vector retrieval constrained through `workspace_documents` in
      the same database query that enforces user and workspace ownership.
- [ ] Implement PostgreSQL full-text retrieval under the identical boundary and literal fallback for
      exact phrases, identifiers, dates, numbers, and units.
- [ ] Fuse vector and lexical rankings with reciprocal-rank fusion rather than comparing raw scores.
- [ ] Deduplicate repeated candidates, penalize overlapping chunks, limit dominance by one parent,
      and retain distinct evidence for requested concepts.
- [ ] Expand winning children to bounded parents or siblings while deduplicating repeated context.
- [ ] Add the authenticated workspace search and retrieval-trace endpoints with strict validation.
- [ ] Build the search UI showing combined/vector/lexical ranks, document, section, page, excerpt,
      source opening, and a link to the persisted retrieval trace.
- [ ] Create the first hand-authored evaluation set with expected documents/pages and adversarial
      workspace-isolation, exact-value, conflict, absent-answer, and OCR-corruption cases.

### Verification

- [ ] Identical queries cannot retrieve a user-owned document unless it is attached to the active workspace.
- [ ] Invalid document/tag filters are rejected or removed without relaxing the workspace boundary.
- [ ] Known evaluation questions retrieve their expected document and page in the recorded top results.
- [ ] Exact numbers, units, dates, identifiers, and defined terms exercise lexical/literal retrieval.
- [ ] Retrieval traces reproduce the eligible document set and explain every selected source.
- [ ] Search works without calling a generation model.

**Exit gate:** Workspace-scoped hybrid search consistently surfaces the expected pages for the initial
evaluation set and passes isolation tests before answer synthesis begins.

## Stage 8 — Cited answers and conversations

**Goal:** Add question answering that remains subordinate to retrieved and inspectable evidence.

**North Star references:** [Query planning](./NORTHSTAR.md#81-query-planning),
[Answer synthesis](./NORTHSTAR.md#85-answer-synthesis),
[Conversations, messages, and retrieval runs](./NORTHSTAR.md#conversations-messages-and-retrieval_runs),
and [Ask](./NORTHSTAR.md#ask).

**Dependencies:** Stage 7 exit gate.

### Work

- [ ] Add workspace-owned conversations and messages, preserving the immutable workspace association
      and linking each answer to its retrieval run.
- [ ] Implement the `GenerationProvider` interface and configured adapter without exposing provider
      types to domain services.
- [ ] Implement direct-query planning for simple questions and structured decomposition only for
      comparisons, multi-part requirements, temporal distinctions, or multiple entities.
- [ ] Validate planner output with the North Star schema and restrict document/tag filters to values
      that exist inside the active workspace.
- [ ] If optional filters yield no evidence, retry without only those filters and disclose the
      relaxation in the retrieval trace. Never relax user or workspace scope.
- [ ] Build bounded evidence packets with opaque source IDs and generate answers using only those records.
- [ ] Validate every returned citation ID server-side. Unknown IDs cause a controlled failure or one
      bounded regeneration attempt, never a fabricated citation.
- [ ] Persist the question, plan, evidence, provider/model configuration, answer, and resolved citations.
- [ ] Build workspace conversation history, question input, eligible-document indicator, cited answer,
      conflict/insufficient-evidence state, source cards, and page/region opening.

### Verification

- [ ] Fake-provider tests cover valid citations, unknown citations, uncited material claims, provider
      failure, malformed structured output, and bounded regeneration.
- [ ] Every displayed citation resolves to evidence supplied during that exact retrieval run.
- [ ] Questions absent from the corpus return an explicit insufficient-evidence response.
- [ ] Conflicting documents are presented as conflicts with citations for each position.
- [ ] Exact values and defined terms remain unchanged from their cited evidence.
- [ ] Conversation history cannot move between or retrieve across workspaces.

**Exit gate:** Answers cite only supplied sources, citations open the correct PDF pages, and unsupported
or conflicting questions receive explicit evidence-aware responses.

## Stage 9 — Lifecycle, production hardening, and MVP release

**Goal:** Make the complete system recoverable, observable, secure, and supportable on the target VPS.

**North Star references:** [Deletion and garbage collection](./NORTHSTAR.md#deletion-and-garbage-collection),
[Security and safety](./NORTHSTAR.md#12-security-and-safety),
[Observability](./NORTHSTAR.md#13-observability), [Quality and evaluation](./NORTHSTAR.md#11-quality-and-evaluation),
and [MVP acceptance criteria](./NORTHSTAR.md#15-mvp-acceptance-criteria).

**Dependencies:** Stages 1–8.

### Work

- [ ] Add full re-extraction, rechunking, and re-embedding controls with immutable inputs,
      independently retryable stages, and explicit derivation versions.
- [ ] Implement explicit document deletion: require removal/confirmation of all attachments, mark the
      document deleting, enqueue an immutable object manifest, delete idempotently, then purge rows.
- [ ] Implement delayed orphan-object reconciliation and database-reference checks without deleting
      recent uploads or objects referenced by any document/derivation.
- [ ] Enable and document Hetzner bucket versioning plus a lifecycle policy that bounds old versions
      while retaining deletions long enough for recovery.
- [ ] Document and automate PostgreSQL backup, bucket inventory, restore, and post-restore reconciliation;
      prove recovery using non-production infrastructure.
- [ ] Set one ingestion job at a time by default for the 2-vCPU/4-GB VPS, bound worker CPU/RAM/scratch
      usage, rotate logs, and pause new ingestion before disk exhaustion.
- [ ] Add `/health/live` and `/health/ready`; report database/storage readiness separately from worker
      toolchain and AI-provider availability.
- [ ] Add structured stage timings, request/workspace/document/job/retrieval IDs, worker heartbeat,
      object reconciliation results, and actionable user-safe errors without logging secrets.
- [ ] Complete upload/page limits, private-bucket policy, object-key validation, subprocess hardening,
      prompt-injection defenses, dependency pinning, and public-host deployment documentation.
- [ ] Run and record OCR/extraction coverage, citation/page recall, retrieval hit rate, concept coverage,
      unsupported-claim rate, exact-number accuracy, and stage latency on the evaluation corpus.
- [ ] Complete clean-machine Compose deployment and critical Playwright flows for workspace creation,
      upload/reuse, ingestion, inspection, search, cited answers, detach, reprocess, and deletion.

### Verification

- [ ] Forced interruption at every ingestion stage converges safely after retry without duplicate rows
      or published partial artifacts.
- [ ] Garbage collection survives partial object deletion and remains visible/retryable.
- [ ] A database/object restore produces a mutually consistent, searchable non-production system.
- [ ] API browsing and non-generative search remain available during worker or AI-provider outages.
- [ ] Resource tests demonstrate bounded one-job ingestion on the target VPS configuration.
- [ ] `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm lint:types`, `pnpm format:check`, and
      `pnpm test` pass from a clean checkout with documented prerequisites.
- [ ] Every item in the MVP traceability matrix below has passing automated evidence or a documented
      manual verification procedure.

**Exit gate:** A clean deployment with dedicated Hetzner credentials satisfies every North Star MVP
criterion and has tested interruption recovery, deletion, reconciliation, backup, and restore behavior.

## MVP acceptance traceability

The wording below is abbreviated. The complete acceptance criteria remain authoritative in
[North Star §15](./NORTHSTAR.md#15-mvp-acceptance-criteria).

|   # | Required outcome                                                              | Owning stage | Primary verification                              |
| --: | ----------------------------------------------------------------------------- | -----------: | ------------------------------------------------- |
|   1 | Representative PDFs ingest without modifying originals                        |            5 | Fixture hashes and extraction integration tests   |
|   2 | One document attaches to several workspaces without duplicate processing      |            3 | Upload/deduplication repository and storage tests |
|   3 | Detach/workspace deletion preserves documents used elsewhere                  |         3, 9 | Attachment lifecycle and deletion tests           |
|   4 | Search/chat cannot cross the active workspace boundary                        |         7, 8 | Adversarial workspace-isolation tests             |
|   5 | Retrieval runs preserve workspace and eligible document IDs                   |            7 | Retrieval-run persistence tests                   |
|   6 | Image-only and mixed PDFs receive searchable OCR text                         |            5 | Real-tool fixture integration tests               |
|   7 | Every chunk links to a physical PDF page                                      |            6 | Provenance constraint/property tests              |
|   8 | Most chunks have valid source bounding boxes                                  |            6 | Fixture coverage and coordinate validation        |
|   9 | UI shows source text and opens authenticated page ranges                      |         5, 7 | Inspector and browser tests                       |
|  10 | Workspace document/tag filters constrain retrieval                            |         7, 8 | Filter validation and retrieval tests             |
|  11 | Search combines semantic and exact-term retrieval                             |            7 | Hybrid ranking evaluation                         |
|  12 | Parent expansion adds bounded non-duplicated context                          |            7 | Context-expansion unit/evaluation tests           |
|  13 | Material answer claims contain validated citations                            |            8 | Citation validation and answer evaluation         |
|  14 | Missing evidence produces an insufficient-evidence response                   |            8 | Absent-answer evaluation cases                    |
|  15 | Retrieval traces explain source selection                                     |            7 | Persisted trace/API/UI tests                      |
|  16 | Re-running ingestion is idempotent and interruption-safe                      |         4, 9 | Lease, retry, and fault-injection tests           |
|  17 | Deployment requires Compose, Hetzner credentials, and optional AI credentials |         1, 9 | Clean-machine deployment test                     |

## Deferred work

The items in [North Star §16](./NORTHSTAR.md#16-decisions-intentionally-deferred) are deliberately not
scheduled in the MVP roadmap. This includes SQLite distribution, approximate-vector index tuning,
additional authentication and sharing, rich OCR correction, table-specific extraction, cross-encoder
reranking, a fully local default generation model, cross-user attachment, and mobile-specific UI.

Promote a deferred item into this roadmap only after its need is demonstrated and the North Star has
been updated with its intended behavior and architectural constraints.
