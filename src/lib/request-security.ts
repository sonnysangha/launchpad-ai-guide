import type { z } from "zod";
import { AppError } from "./errors";

export function assertSameOrigin(request: Request, allowedOrigin: string) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin !== allowedOrigin || (fetchSite && fetchSite !== "same-origin")) {
    throw new AppError("INVALID_ORIGIN", "This action must be requested from Launchpad.", 403);
  }
}

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    throw new AppError("INVALID_CONTENT_TYPE", "Send this request as JSON.", 415);
  }
  const limit = 8_192;
  if (Number(request.headers.get("content-length")) > limit) {
    throw new AppError("PAYLOAD_TOO_LARGE", "This request is too large.", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("INVALID_JSON", "A JSON request body is required.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new AppError("PAYLOAD_TOO_LARGE", "This request is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new AppError("INVALID_JSON", "The JSON request could not be read.", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Check the form fields.", 400);
  }
  return parsed.data;
}
