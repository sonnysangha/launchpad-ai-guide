import Link from "next/link";
import { SignUp } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { hasClerkConfiguration } from "@/lib/config";

export default function SignUpPage() {
  if (!hasClerkConfiguration()) redirect("/setup");
  return <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", gap: 32, alignItems: "center", justifyContent: "center", padding: 24 }}><Link href="/" style={{ fontSize: 28, fontWeight: 700, textDecoration: "none" }}>launchpad</Link><SignUp routing="path" path="/sign-up" signInUrl="/sign-in" forceRedirectUrl="/" /></main>;
}
