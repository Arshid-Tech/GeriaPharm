import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type SqlParam = string | number | null;

export interface QueryExecutor {
  get<T = Record<string, unknown>>(
    sql: string,
    ...params: SqlParam[]
  ): Promise<T | undefined>;
  all<T = Record<string, unknown>>(
    sql: string,
    ...params: SqlParam[]
  ): Promise<T[]>;
  run(sql: string, ...params: SqlParam[]): Promise<{ changes: number }>;
}

export interface DatabaseStore extends QueryExecutor {
  readonly kind: "postgres" | "sqlite";
  /** Underlying SQLite handle (undefined when running on PostgreSQL). */
  readonly sqlite?: DatabaseSync;
  migrate(): Promise<void>;
  transaction<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function toPgPlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function shouldUsePgSsl(connectionString: string): boolean {
  if (/[?&]sslmode=disable/i.test(connectionString)) return false;
  if (process.env.DATABASE_SSL === "false") return false;
  if (process.env.DATABASE_SSL === "true") return true;
  if (process.env.RENDER === "true") return true;
  try {
    const parsed = new URL(connectionString);
    return !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return true;
  }
}

export async function createDatabaseStore(options: {
  databaseUrl?: string;
  databasePath?: string;
}): Promise<DatabaseStore> {
  const url = options.databaseUrl?.trim();
  if (url && /^postgres(?:ql)?:\/\//i.test(url)) {
    return createPostgresStore(url);
  }
  return createSqliteStore(options.databasePath ?? "data/geriapharm.sqlite");
}

function createSqliteStore(databasePath: string): DatabaseStore {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  }
  const db = new DatabaseSync(databasePath);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
  );

  const executor: QueryExecutor = {
    async get<T>(sql: string, ...params: SqlParam[]) {
      return db.prepare(sql).get(...(params as SQLInputValue[])) as
        | T
        | undefined;
    },
    async all<T>(sql: string, ...params: SqlParam[]) {
      return db.prepare(sql).all(...(params as SQLInputValue[])) as T[];
    },
    async run(sql: string, ...params: SqlParam[]) {
      const result = db.prepare(sql).run(...(params as SQLInputValue[]));
      return { changes: Number(result.changes) };
    },
  };

  return {
    kind: "sqlite",
    sqlite: db,
    ...executor,
    async migrate() {
      db.exec(`BEGIN;
        CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS admins(id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,csrf TEXT NOT NULL,expires_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
        CREATE TABLE IF NOT EXISTS registry(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS login_attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,created_at TEXT NOT NULL);
        INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT(version) DO NOTHING;
        COMMIT;`);
      db.exec(`BEGIN;
        CREATE TABLE IF NOT EXISTS survey_responses(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,received_at TEXT NOT NULL,age INTEGER NOT NULL,gender TEXT NOT NULL,occupation TEXT NOT NULL,answers TEXT NOT NULL,answered INTEGER NOT NULL,total INTEGER NOT NULL,mean REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS survey_responses_received ON survey_responses(received_at);
        CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL);
        INSERT INTO schema_migrations(version) VALUES(2) ON CONFLICT(version) DO NOTHING;
        COMMIT;`);
    },
    async transaction<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T> {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = await fn(executor);
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async close() {
      db.close();
    },
  };
}

async function createPostgresStore(connectionString: string): Promise<DatabaseStore> {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString,
    ssl: shouldUsePgSsl(connectionString)
      ? { rejectUnauthorized: false }
      : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  const makeExecutor = (
    runner: Pick<import("pg").PoolClient, "query">,
  ): QueryExecutor => ({
    async get<T>(sql: string, ...params: SqlParam[]) {
      const res = await runner.query(toPgPlaceholders(sql), params);
      return res.rows[0] as T | undefined;
    },
    async all<T>(sql: string, ...params: SqlParam[]) {
      const res = await runner.query(toPgPlaceholders(sql), params);
      return res.rows as T[];
    },
    async run(sql: string, ...params: SqlParam[]) {
      const res = await runner.query(toPgPlaceholders(sql), params);
      return { changes: res.rowCount ?? 0 };
    },
  });

  const rootExecutor = makeExecutor(pool);

  return {
    kind: "postgres",
    ...rootExecutor,
    async migrate() {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`
          CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
          CREATE TABLE IF NOT EXISTS admins(id SERIAL PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,csrf TEXT NOT NULL,expires_at BIGINT NOT NULL);
          CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
          CREATE TABLE IF NOT EXISTS registry(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS login_attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at BIGINT NOT NULL);
          CREATE TABLE IF NOT EXISTS audit_log(id SERIAL PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,created_at TEXT NOT NULL);
          INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT(version) DO NOTHING;
          CREATE TABLE IF NOT EXISTS survey_responses(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,received_at TEXT NOT NULL,age INTEGER NOT NULL,gender TEXT NOT NULL,occupation TEXT NOT NULL,answers TEXT NOT NULL,answered INTEGER NOT NULL,total INTEGER NOT NULL,mean DOUBLE PRECISION NOT NULL);
          CREATE INDEX IF NOT EXISTS survey_responses_received ON survey_responses(received_at);
          CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at BIGINT NOT NULL);
          INSERT INTO schema_migrations(version) VALUES(2) ON CONFLICT(version) DO NOTHING;
        `);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async transaction<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(makeExecutor(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
