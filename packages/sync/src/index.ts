import type { Actions, TreeStore } from "@kinbook/core";
import { registerStore } from "@kinbook/core";
import { Repositories, TreeDatabase } from "@kinbook/database";
import { SyncStore } from "./store";

export { SyncStore } from "./store";

/**
 * Open the tree on disk, register the sync store as the shared actions layer,
 * and return an `Actions` handle for CLI and MCP to call.
 */
export function openTree(filename: string | undefined): { actions: Actions; close: () => void } {
  const db = new TreeDatabase(filename ?? ":memory:");
  const repo = new Repositories(db);
  const store = new SyncStore(repo);
  registerStore(store);
  return {
    actions: store,
    close: () => db.close(),
  };
}