import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { appOrigin, hasClerkConfiguration } from "./lib/config";

const clerk = clerkMiddleware({ authorizedParties: [appOrigin()] });

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  // Setup pages remain readable without credentials. Every protected resource
  // independently checks configuration and verified Clerk authentication.
  if (!hasClerkConfiguration()) return NextResponse.next();
  return clerk(request, event);
}

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
