import { ApiError } from "../lib/error.js";

export function uploadError(
  status: 400 | 404 | 408 | 409 | 413 | 415 | 422 | 503,
  code: string,
  message: string,
) {
  return new ApiError({ status, code, message, userMessage: message, expose: true });
}

export function throwIfUploadAborted(signal: AbortSignal): void {
  if (signal.aborted)
    throw uploadError(408, "UPLOAD_ABORTED", "The upload was interrupted or timed out.");
}
