import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getReasonPhrase, StatusCodes } from "http-status-codes";
import { type ApiEnv } from "@repo/env/api";

export type ApiErrorDetails = Record<string, unknown>;
export type ApiErrorMetadata = Record<string, unknown>;

export type ApiErrorOptions = {
  cause?: unknown;
  code: string;
  details?: ApiErrorDetails | undefined;
  expose?: boolean | undefined;
  metadata?: ApiErrorMetadata | undefined;
  message: string;
  requestId?: string | undefined;
  status: ContentfulStatusCode;
  tags?: string[] | undefined;
  timestamp?: string | undefined;
  title?: string | undefined;
  type?: string | undefined;
  userMessage?: string | undefined;
};

export type ProblemDetails = {
  code: string;
  detail?: string | undefined;
  details?: ApiErrorDetails | undefined;
  instance?: string | undefined;
  requestId?: string | undefined;
  status: ContentfulStatusCode;
  title: string;
  type: string;
};

const normalizeCodeForType = (code: string) =>
  code
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-");

const getDefaultTitle = (status: ContentfulStatusCode) => {
  try {
    return getReasonPhrase(status);
  } catch {
    return "Unknown Error";
  }
};

const getDefaultType = (code: string) => `urn:repo:error:${normalizeCodeForType(code)}`;

const getDefaultPublicDetail = (status: ContentfulStatusCode) => {
  const internalServerErrorStatus: number = StatusCodes.INTERNAL_SERVER_ERROR;

  if (status >= internalServerErrorStatus) {
    return "An unexpected error occurred.";
  }

  return "The request could not be completed.";
};

export class ApiError extends Error {
  readonly code: string;
  readonly details?: ApiErrorDetails | undefined;
  readonly expose?: boolean | undefined;
  readonly metadata?: ApiErrorMetadata | undefined;
  readonly requestId?: string | undefined;
  readonly status: ContentfulStatusCode;
  readonly tags: string[];
  readonly timestamp: string;
  readonly title: string;
  readonly type: string;
  readonly userMessage?: string | undefined;

  constructor(options: ApiErrorOptions) {
    const {
      cause,
      code,
      details,
      expose,
      metadata,
      message,
      requestId,
      status,
      tags,
      timestamp,
      title,
      type,
      userMessage,
    } = options;

    super(message, cause === undefined ? undefined : { cause });

    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = details;
    this.expose = expose;
    this.metadata = metadata;
    this.requestId = requestId;
    this.tags = tags ?? [];
    this.timestamp = timestamp ?? new Date().toISOString();
    this.title = title ?? getDefaultTitle(status);
    this.type = type ?? getDefaultType(code);
    this.userMessage = userMessage;

    Error.captureStackTrace?.(this, new.target);
  }

  shouldExpose(env: ApiEnv["NODE_ENV"]): boolean {
    if (this.expose !== undefined) {
      return this.expose;
    }

    return env !== "production";
  }

  toProblem(env: ApiEnv, options?: { instance?: string; requestId?: string }): ProblemDetails {
    const shouldExpose = this.shouldExpose(env.NODE_ENV);
    const detail = shouldExpose
      ? (this.userMessage ?? this.message)
      : (this.userMessage ?? getDefaultPublicDetail(this.status));

    return {
      type: this.type,
      title: this.title,
      status: this.status,
      detail,
      code: this.code,
      details: shouldExpose ? this.details : undefined,
      instance: options?.instance ?? this.requestId,
      requestId: options?.requestId ?? this.requestId,
    };
  }

  toLogObject() {
    return {
      name: this.name,
      code: this.code,
      status: this.status,
      title: this.title,
      type: this.type,
      message: this.message,
      userMessage: this.userMessage,
      details: this.details,
      metadata: this.metadata,
      tags: this.tags,
      requestId: this.requestId,
      timestamp: this.timestamp,
      stack: this.stack,
      cause: this.cause,
    };
  }
}

export const isApiError = (value: unknown): value is ApiError => value instanceof ApiError;

export const toApiError = (
  value: unknown,
  fallback?: Partial<Omit<ApiErrorOptions, "message">>,
) => {
  if (isApiError(value)) {
    return value;
  }

  const fallbackStatus = fallback?.status ?? StatusCodes.INTERNAL_SERVER_ERROR;
  const fallbackCode = fallback?.code ?? "INTERNAL_ERROR";

  if (value instanceof Error) {
    return new ApiError({
      cause: value,
      code: fallbackCode,
      details: fallback?.details,
      expose: fallback?.expose,
      metadata: fallback?.metadata,
      message: value.message,
      requestId: fallback?.requestId,
      status: fallbackStatus,
      tags: fallback?.tags,
      timestamp: fallback?.timestamp,
      title: fallback?.title,
      type: fallback?.type,
      userMessage: fallback?.userMessage,
    });
  }

  return new ApiError({
    code: fallbackCode,
    details: fallback?.details,
    expose: fallback?.expose,
    metadata: {
      thrownValue: value,
      ...fallback?.metadata,
    },
    message: "Non-error value thrown",
    requestId: fallback?.requestId,
    status: fallbackStatus,
    tags: fallback?.tags,
    timestamp: fallback?.timestamp,
    title: fallback?.title,
    type: fallback?.type,
    userMessage: fallback?.userMessage,
  });
};
