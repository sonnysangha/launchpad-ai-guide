import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { hasClerkConfiguration } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  title: "Launchpad — a little clarity, a great start",
  description: "A fictional project workspace with a conversational setup guide.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const content = <html lang="en"><body>{children}</body></html>;
  return hasClerkConfiguration() ? (
    <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" signInFallbackRedirectUrl="/" signUpFallbackRedirectUrl="/">
      {content}
    </ClerkProvider>
  ) : content;
}
