import "server-only";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { LaunchpadStore } from "./store";

const globalDb = globalThis as typeof globalThis & { launchpadStore?: LaunchpadStore };

export function getStore(): LaunchpadStore {
  if (!globalDb.launchpadStore) {
    const path = resolve(process.env.LAUNCHPAD_DB_PATH || ".data/launchpad.sqlite");
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    globalDb.launchpadStore = new LaunchpadStore(path);
    chmodSync(path, 0o600);
  }
  return globalDb.launchpadStore;
}

export const getWorkspace = (ownerId: string) => getStore().getWorkspace(ownerId);
