export function hasClerkConfiguration(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() && process.env.CLERK_SECRET_KEY?.trim());
}

export function appOrigin(): string {
  return new URL(process.env.LAUNCHPAD_APP_ORIGIN || "http://127.0.0.1:3212").origin;
}
