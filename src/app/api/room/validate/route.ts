import { z } from "zod";
import { getStore } from "@/lib/db";
import { apiError, AppError, privateJson } from "@/lib/errors";
import { readJson } from "@/lib/request-security";
import { validateActiveRoom } from "@/lib/room-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ metadata: z.string().min(1).max(7_000) }).strict();

export async function POST(request: Request) {
  try {
    const secret = process.env.LAUNCHPAD_AGENT_SECRET?.trim();
    if (!secret || secret.length < 32) {
      throw new AppError("SETUP_REQUIRED", "The guide signing key is not configured.", 503);
    }
    // Read-only worker endpoint: the signed envelope is its authentication.
    // Browser session cookies and client-supplied ownership are never trusted.
    const { metadata } = await readJson(request, schema);
    return privateJson(validateActiveRoom(metadata, secret, getStore()));
  } catch (error) { return apiError(error); }
}
