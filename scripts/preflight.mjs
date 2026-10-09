import { existsSync } from "node:fs";
import { resolve } from "node:path";

for (const file of [".env.local", "agent/.env"]) {
  if (existsSync(file)) process.loadEnvFile(resolve(file));
}
const groups = {
  authentication: ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"],
  room: ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "LAUNCHPAD_AGENT_SECRET"],
  avatar: ["SYNTHESIA_API_KEY", "SYNTHESIA_AVATAR_ID", "OPENAI_API_KEY"],
};
const missing = Object.fromEntries(Object.entries(groups).map(([group, names]) => [group, names.filter(name => !process.env[name]?.trim())]));
const invalid = [];
if (process.env.LAUNCHPAD_AGENT_SECRET && process.env.LAUNCHPAD_AGENT_SECRET.length < 32) invalid.push("LAUNCHPAD_AGENT_SECRET");
if (process.env.LIVEKIT_URL) {
  try { if (new URL(process.env.LIVEKIT_URL).protocol !== "wss:") invalid.push("LIVEKIT_URL"); }
  catch { invalid.push("LIVEKIT_URL"); }
}
console.log(JSON.stringify({ node: process.version, missing, invalid, remoteChecks: "not_run", realAvatarVerified: false }, null, 2));
process.exitCode = Object.values(missing).some(names => names.length) || invalid.length ? 1 : 0;
