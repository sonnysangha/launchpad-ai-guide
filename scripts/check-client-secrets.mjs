import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

// Values never leave this process. Reports contain variable names and paths only.
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const secretNames = [
  "CLERK_SECRET_KEY", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET",
  "LAUNCHPAD_AGENT_SECRET", "SYNTHESIA_API_KEY", "OPENAI_API_KEY",
];
const envFiles = [
  ".env", ".env.local", ".env.development", ".env.development.local",
  ".env.production", ".env.production.local", "agent/.env",
];
const bundleRoots = [".next/static", ".next/dev/static"];

function filesWithin(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesWithin(path);
    // Do not follow symlinks outside the client asset directories.
    return entry.isFile() ? [path] : [];
  });
}

try {
  const values = new Map(secretNames.map((name) => [name, new Set()]));
  const collect = (env) => {
    for (const name of secretNames) {
      const value = env[name]?.trim();
      if (value) values.get(name).add(value);
    }
  };
  collect(process.env);
  for (const file of envFiles) {
    const path = join(root, file);
    if (existsSync(path)) collect(parseEnv(readFileSync(path, "utf8")));
  }

  const checkedVariables = secretNames.filter((name) => values.get(name).size);
  const missingVariables = secretNames.filter((name) => !values.get(name).size);
  const patterns = checkedVariables.map((name) => ({
    name,
    needles: [...values.get(name)].flatMap((value) => [...new Set([
      value, JSON.stringify(value).slice(1, -1),
      Buffer.from(value).toString("base64"), Buffer.from(value).toString("base64url"),
    ])]).map((value) => Buffer.from(value)),
  }));
  const scopes = bundleRoots.filter((path) => existsSync(join(root, path)));
  const files = scopes.flatMap((path) => filesWithin(join(root, path)));
  const matches = [];
  for (const path of files) {
    const content = readFileSync(path);
    for (const { name, needles } of patterns) {
      if (needles.some((needle) => content.includes(needle))) {
        matches.push({ variable: name, path: relative(root, path) });
      }
    }
  }
  const status = !files.length || !checkedVariables.length ? "incomplete" : matches.length ? "failed" : "passed";
  console.log(JSON.stringify({ status, scopes, filesScanned: files.length, checkedVariables, missingVariables, matches }, null, 2));
  process.exitCode = status === "passed" ? 0 : 1;
} catch {
  // Parser/filesystem errors can embed private source text; never print them.
  console.error("Client secret scan could not complete. No secret values were logged.");
  process.exitCode = 1;
}
