import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import type { SQLQueryBindings } from "bun:sqlite";

export type Bindings = SQLQueryBindings;
const SCHEMA_SQL = readFileSync(join(import.meta.dir, "schema.sql"), "utf8");

export class TreeDatabase {
  readonly db: Database;

  constructor(filename: string = ":memory:") {
    this.db = new Database(filename);
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    this.db.close();
  }
}