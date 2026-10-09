import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { hasClerkConfiguration } from "@/lib/config";
import { getWorkspace } from "@/lib/db";
import Dashboard from "@/components/Dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  if (!hasClerkConfiguration()) redirect("/setup");
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const workspace = getWorkspace(userId);
  if (!workspace) redirect("/onboarding");
  return <Dashboard workspace={workspace} />;
}
