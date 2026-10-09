// Next may load a globally cached store from a different server bundle. A
// process-wide symbol identifies our errors without depending on class identity.
const APP_ERROR_BRAND = Symbol.for("launchpad.app-error");

export class AppError extends Error {
  readonly [APP_ERROR_BRAND] = true;
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = "AppError";
  }
}

function isAppError(error: unknown): error is AppError {
  if (!error || typeof error !== "object" || !(APP_ERROR_BRAND in error) || error[APP_ERROR_BRAND] !== true) return false;
  const candidate = error as Partial<AppError>;
  return candidate.name === "AppError" && typeof candidate.message === "string" &&
    typeof candidate.code === "string" && /^[A-Z][A-Z0-9_]*$/.test(candidate.code) &&
    typeof candidate.status === "number" && Number.isInteger(candidate.status) && candidate.status >= 400 && candidate.status <= 599;
}

export function apiError(error: unknown): Response {
  if (isAppError(error)) {
    return Response.json({ error: error.message, code: error.code }, {
      status: error.status, headers: { "Cache-Control": "no-store" },
    });
  }
  // Provider errors can contain request headers or tokens. Never echo or log them.
  return Response.json({ error: "The request could not be completed. Please try again.", code: "INTERNAL_ERROR" }, {
    status: 500, headers: { "Cache-Control": "no-store" },
  });
}

export function privateJson(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
