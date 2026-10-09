import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { hasClerkConfiguration } from "@/lib/config";
import { getWorkspace } from "@/lib/db";
import Onboarding from "@/components/Onboarding";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  if (!hasClerkConfiguration()) redirect("/setup");
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  if (getWorkspace(userId)) redirect("/dashboard");
  return <Onboarding />;
}
