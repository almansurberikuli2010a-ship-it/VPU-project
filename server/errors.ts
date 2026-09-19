import type { Result } from "../shared/contracts.js";
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus = 502,
  ) {
    super(message);
  }
}
export function errorResult(
  error: unknown,
): Extract<Result, { status: "error" }> {
  if (error instanceof AppError)
    return { status: "error", error_code: error.code, message: error.message };
  if (
    error instanceof Error &&
    ["AbortError", "TimeoutError"].includes(error.name)
  )
    return {
      status: "error",
      error_code: "DEADLINE_EXCEEDED",
      message:
        "The search took too long. Please try again with the full university name.",
    };
  return {
    status: "error",
    error_code: "INTERNAL_ERROR",
    message: "We could not build this profile. Please try again.",
  };
}
