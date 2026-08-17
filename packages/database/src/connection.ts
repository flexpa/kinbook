/// <reference path="./sql.d.ts" />
import { Database } from "bun:sqlite";
import type { SQLQueryBindings } from "bun:sqlite";
// a text import (not readFileSync) so `bun build --compile` embeds the schema
import SCHEMA_SQL from "./schema.sql" with { type: "text" };

export type Bindings = SQLQueryBindings;

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