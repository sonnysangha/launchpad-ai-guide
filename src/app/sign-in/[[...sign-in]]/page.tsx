import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { hasClerkConfiguration } from "@/lib/config";

export default function SignInPage() {
  if (!hasClerkConfiguration()) redirect("/setup");
  return <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", gap: 32, alignItems: "center", justifyContent: "center", padding: 24 }}><Link href="/" style={{ fontSize: 28, fontWeight: 700, textDecoration: "none" }}>launchpad</Link><SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" forceRedirectUrl="/" /></main>;
}
