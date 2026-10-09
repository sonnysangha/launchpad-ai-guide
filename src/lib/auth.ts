import "server-only";
import { auth } from "@clerk/nextjs/server";
import { hasClerkConfiguration } from "./config";
import { AppError } from "./errors";

export async function requireUser(): Promise<string> {
  if (!hasClerkConfiguration()) {
    throw new AppError("SETUP_REQUIRED", "Clerk sign-in is not configured yet. Complete the local setup before continuing.", 503);
  }
  const { userId } = await auth({ acceptsToken: "session_token" });
  if (!userId) throw new AppError("UNAUTHENTICATED", "Sign in to continue.", 401);
  return userId;
}
