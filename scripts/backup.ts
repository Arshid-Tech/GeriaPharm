import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createDatabaseStore } from "../server/db";

const dir = resolve(process.env.BACKUP_DIR ?? "data/backups");
mkdirSync(dir, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const databaseUrl = process.env.DATABASE_URL?.trim();

if (databaseUrl && /^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
  const store = await createDatabaseStore({ databaseUrl });
  try {
    const registry = await store.get<{
      data: string;
      revision: number | string;
      updated_at: string;
    }>("SELECT data, revision, updated_at FROM registry WHERE id=1");
    const surveyResponses = await store.all(
      "SELECT * FROM survey_responses ORDER BY received_at DESC",
    );
    const auditLog = await store.all(
      "SELECT * FROM audit_log ORDER BY id DESC LIMIT 1000",
    );
    const target = join(dir, `geriapharm-pg-${stamp}.json`);
    const snapshot = {
      schemaVersion: 1,
      database: "postgres",
      exportedAt: new Date().toISOString(),
      registry: registry
        ? {
            revision: Number(registry.revision),
            updatedAt: registry.updated_at,
            medications: JSON.parse(registry.data),
          }
        : null,
      surveyResponses,
      auditLog,
    };
    writeFileSync(target, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
    console.log("پشتیبان کامل PostgreSQL ذخیره شد: " + target);
  } finally {
    await store.close();
  }
} else {
  const { DatabaseSync, backup } = await import("node:sqlite");
  const source = resolve(process.env.DATABASE_PATH ?? "data/geriapharm.sqlite");
  const target = join(dir, `geriapharm-${stamp}.sqlite`);
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(db, target);
    console.log("پشتیبان کامل پایگاه داده ذخیره شد: " + target);
  } finally {
    db.close();
  }
}
