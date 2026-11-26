import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import {
  randomBytes,
  randomUUID,
  scrypt as scryptCb,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { z } from "zod";
import {
  registrySchema,
  drugSchema,
  surveySubmissionSchema,
  type Gender,
  type Occupation,
  type SurveyAnswers,
} from "../src/types/types";
import { seedData } from "../src/data/seedData";
import {
  GENDER_LABELS,
  OCCUPATION_LABELS,
  UMARS_QUESTIONS,
} from "../src/data/umarsQuestions";
import { createDatabaseStore, type QueryExecutor } from "./db";

const scrypt = promisify(scryptCb);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const cookie = "gp_session";

export function normalizeOrigins(raw: string): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((item) => item.trim().replace(/\/+$/, ""))
      .filter(Boolean),
  );
}

/**
 * Escapes a single CSV cell: guards against spreadsheet formula injection
 * (`=`, `+`, `-`, `@`, tab, CR) and quotes cells with commas/quotes/newlines.
 */
export function csvCell(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return salt + ":" + key.toString("hex");
}

async function verify(password: string, encoded: string) {
  const parts = encoded.split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const [salt, key] = parts;
  const expected = Buffer.from(key, "hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

interface Config {
  databaseUrl?: string;
  databasePath?: string;
  origin: string;
  secureCookies: boolean;
  adminEmail?: string;
  adminPassword?: string;
  serveStatic?: boolean;
  trustProxy?: boolean;
  proxyHops?: number;
  surveyRateLimit?: number;
  loginIpRateLimit?: number;
  now?: () => number;
}

export async function createApp(config: Config) {
  const store = await createDatabaseStore({
    databaseUrl: config.databaseUrl,
    databasePath: config.databasePath,
  });
  await store.migrate();

  if (!(await store.get("SELECT id FROM admins LIMIT 1"))) {
    if (
      !config.adminEmail ||
      !config.adminPassword ||
      config.adminPassword.length < 12 ||
      config.adminPassword.startsWith("replace-")
    )
      throw new Error(
        "برای راه‌اندازی اولیه، ADMIN_EMAIL و ADMIN_PASSWORD با حداقل ۱۲ نویسه لازم است. npm run setup را اجرا کنید.",
      );
    const email = z.string().email().parse(config.adminEmail).toLowerCase();
    await store.run(
      "INSERT INTO admins(email,password_hash) VALUES(?,?)",
      email,
      await passwordHash(config.adminPassword),
    );
  }

  await store.run(
    "INSERT INTO registry(id,data,revision,updated_at) VALUES(1,?,1,?) ON CONFLICT(id) DO NOTHING",
    JSON.stringify(seedData),
    new Date().toISOString(),
  );

  const allowedOrigins = normalizeOrigins(config.origin);
  const surveyRateLimit =
    config.surveyRateLimit && config.surveyRateLimit > 0
      ? config.surveyRateLimit
      : 20;
  const loginIpRateLimit =
    config.loginIpRateLimit && config.loginIpRateLimit > 0
      ? config.loginIpRateLimit
      : 8;
  const dummy = await passwordHash(token());
  const now = config.now ?? Date.now;
  const app = express();
  app.disable("x-powered-by");
  if (config.proxyHops === 1) app.set("trust proxy", 1);
  else if (config.trustProxy) app.set("trust proxy", "loopback");

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.secureCookies ? [] : null,
        },
      },
      strictTransportSecurity: config.secureCookies ? undefined : false,
    }),
  );

  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.use("/api", (req, res, next) => {
    const reqOrigin = req.get("origin")?.trim().replace(/\/+$/, "");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (!reqOrigin || !allowedOrigins.has(reqOrigin))
    )
      return void res.status(403).json({ message: "مبدأ درخواست مجاز نیست." });
    next();
  });

  app.use(express.json({ limit: "5mb" }));
  app.use(cookieParser());

  const options = {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "strict" as const,
    path: "/api",
  };

  async function session(req: Request) {
    const value = req.cookies[cookie];
    if (typeof value !== "string" || value.length > 100) return undefined;
    const row = await store.get<{
      token_hash: string;
      admin_id: number;
      csrf: string;
      email: string;
      expires_at: number | string;
    }>(
      "SELECT sessions.*,admins.email FROM sessions JOIN admins ON admins.id=sessions.admin_id WHERE token_hash=? AND expires_at>?",
      hash(value),
      now(),
    );
    if (!row) return undefined;
    return {
      ...row,
      admin_id: Number(row.admin_id),
      expires_at: Number(row.expires_at),
    };
  }

  async function authorize(req: Request, res: Response, next: NextFunction) {
    const current = await session(req);
    if (!current)
      return void res
        .status(401)
        .json({ message: "برای ادامه وارد حساب مدیر شوید." });
    if (!["GET", "HEAD"].includes(req.method)) {
      const csrf = req.get("x-csrf-token") ?? "";
      if (
        Buffer.byteLength(csrf) !== Buffer.byteLength(current.csrf) ||
        !timingSafeEqual(Buffer.from(csrf), Buffer.from(current.csrf))
      )
        return void res
          .status(403)
          .json({ message: "درخواست معتبر نیست؛ صفحه را تازه‌سازی کنید." });
    }
    res.locals.session = current;
    next();
  }

  async function audit(
    actor: string,
    action: string,
    target = "",
    exec: QueryExecutor = store,
  ) {
    await exec.run(
      "INSERT INTO audit_log(actor,action,target,created_at) VALUES(?,?,?,?)",
      actor,
      action,
      target,
      new Date(now()).toISOString(),
    );
  }

  /** Sliding-window request counter for abuse-prone public endpoints. */
  async function consume(key: string, limit: number, windowMs: number) {
    await store.run("DELETE FROM rate_limits WHERE reset_at<=?", now());
    const row = await store.get<{
      count: number | string;
      reset_at: number | string;
    }>("SELECT count,reset_at FROM rate_limits WHERE key=?", key);
    if (row && Number(row.count) >= limit)
      return {
        allowed: false,
        retryAfter: Math.max(
          1,
          Math.ceil((Number(row.reset_at) - now()) / 1000),
        ),
      };
    await store.run(
      "INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=rate_limits.count+1",
      key,
      now() + windowMs,
    );
    return { allowed: true, retryAfter: 0 };
  }

  interface SurveyRow {
    id: string;
    created_at: string;
    received_at: string;
    age: number;
    gender: string;
    occupation: string;
    answers: string;
    answered: number;
    total: number;
    mean: number;
  }

  /** Newest first; identical shape to the client-side `SurveyResponse` type. */
  async function readResponses() {
    const rows = await store.all<SurveyRow>(
      "SELECT * FROM survey_responses ORDER BY received_at DESC",
    );
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      receivedAt: row.received_at,
      demographics: {
        age: Number(row.age),
        gender: row.gender as Gender,
        occupation: row.occupation as Occupation,
      },
      answers: JSON.parse(row.answers) as SurveyAnswers,
      score: {
        answered: Number(row.answered),
        total: Number(row.total),
        mean: Number(row.mean),
      },
    }));
  }

  async function readRegistry(exec: QueryExecutor = store, forUpdate = false) {
    const sql =
      forUpdate && store.kind === "postgres"
        ? "SELECT * FROM registry WHERE id=1 FOR UPDATE"
        : "SELECT * FROM registry WHERE id=1";
    const row = (await exec.get<{
      data: string;
      revision: number | string;
      updated_at: string;
    }>(sql))!;
    return {
      medications: JSON.parse(row.data),
      revision: Number(row.revision),
      updatedAt: row.updated_at,
    };
  }

  async function updateRegistry(
    req: Request,
    res: Response,
    action: string,
    transform: (
      rows: z.infer<typeof registrySchema>,
    ) => z.infer<typeof registrySchema>,
    target = "",
  ) {
    const ifMatch = req.get("if-match");
    if (!ifMatch)
      return res
        .status(428)
        .json({ message: "نسخه فهرست مشخص نیست؛ ابتدا همگام‌سازی کنید." });

    const outcome = await store.transaction(async (tx) => {
      const current = await readRegistry(tx, true);
      if (ifMatch !== String(current.revision)) {
        return { conflict: true as const };
      }
      const meds = registrySchema.parse(transform(current.medications));
      await tx.run(
        "UPDATE registry SET data=?,revision=revision+1,updated_at=? WHERE id=1",
        JSON.stringify(meds),
        new Date(now()).toISOString(),
      );
      await audit(res.locals.session.email, action, target, tx);
      return { conflict: false as const, registry: await readRegistry(tx) };
    });

    if (outcome.conflict) {
      return res.status(409).json({
        message:
          "فهرست توسط مدیر دیگری تغییر کرده است. همگام‌سازی کنید و دوباره تلاش کنید.",
      });
    }
    return res.json(outcome.registry);
  }

  app.get("/api/health", async (_req, res) => {
    await store.get("SELECT 1 AS ok");
    res.json({ status: "ok", database: store.kind });
  });

  app.get("/api/registry", async (_req, res) => {
    res.json(await readRegistry());
  });

  // Public endpoint: stores one anonymous UMARS response. The global Origin
  // check above blocks cross-site posts and `consume` caps bulk submissions;
  // the client-supplied id makes retries after a network failure idempotent.
  app.post("/api/survey", async (req, res) => {
    const input = surveySubmissionSchema.parse(req.body);
    const createdAt = new Date(input.createdAt).getTime();
    if (createdAt > now() + 5 * 60 * 1000)
      return void res.status(400).json({ message: "زمان پاسخ معتبر نیست." });
    const limit = await consume(
      hash("survey:" + req.ip),
      surveyRateLimit,
      60 * 60 * 1000,
    );
    if (!limit.allowed) {
      res.setHeader("Retry-After", String(limit.retryAfter));
      return void res.status(429).json({
        message:
          "تعداد پاسخ‌های ارسالی از این دستگاه بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.",
      });
    }
    const id = input.id ?? randomUUID();
    const values = Object.values(input.answers);
    const total = values.reduce((sum, value) => sum + value, 0);
    const receivedAt = new Date(now()).toISOString();
    const result = await store.run(
      "INSERT INTO survey_responses(id,created_at,received_at,age,gender,occupation,answers,answered,total,mean) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
      id,
      new Date(createdAt).toISOString(),
      receivedAt,
      input.demographics.age,
      input.demographics.gender,
      input.demographics.occupation,
      JSON.stringify(input.answers),
      values.length,
      total,
      values.length ? total / values.length : 0,
    );
    res
      .status(201)
      .json({ id, receivedAt, duplicate: result.changes === 0 });
  });

  app.get("/api/auth/session", async (req, res) => {
    const current = await session(req);
    res.json(
      current
        ? {
            user: { email: current.email },
            csrfToken: current.csrf,
            expiresAt: current.expires_at,
          }
        : { user: null },
    );
  });

  app.post("/api/auth/login", async (req, res) => {
    const input = z
      .object({
        email: z.string().email().max(254),
        password: z.string().min(1).max(1024),
      })
      .parse(req.body);
    const email = input.email.toLowerCase();
    const keys = [
      { key: hash("ip:" + req.ip), limit: loginIpRateLimit },
      { key: hash("account:" + email), limit: 30 },
    ];
    await store.run("DELETE FROM login_attempts WHERE reset_at<=?", now());
    await store.run("DELETE FROM sessions WHERE expires_at<=?", now());
    for (const { key, limit } of keys) {
      const row = await store.get<{
        count: number | string;
        reset_at: number | string;
      }>("SELECT count,reset_at FROM login_attempts WHERE key=?", key);
      if (row && Number(row.count) >= limit) {
        res.setHeader(
          "Retry-After",
          String(Math.max(1, Math.ceil((Number(row.reset_at) - now()) / 1000))),
        );
        return void res.status(429).json({
          message:
            "تلاش‌های ورود بیش از حد مجاز است. ۱۵ دقیقه دیگر دوباره تلاش کنید.",
        });
      }
    }
    for (const { key } of keys)
      await store.run(
        "INSERT INTO login_attempts(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=login_attempts.count+1",
        key,
        now() + 15 * 60 * 1000,
      );
    const admin = await store.get<{ id: number; password_hash: string }>(
      "SELECT * FROM admins WHERE email=?",
      email,
    );
    const valid = await verify(input.password, admin?.password_hash ?? dummy);
    if (!admin || !valid) {
      await audit("ناشناس", "login_failed");
      return void res
        .status(401)
        .json({ message: "ایمیل یا رمز عبور نادرست است." });
    }
    // Rotate any previous session; never accept a client-provided session identifier.
    if (typeof req.cookies[cookie] === "string")
      await store.run(
        "DELETE FROM sessions WHERE token_hash=?",
        hash(req.cookies[cookie]),
      );
    for (const { key } of keys)
      await store.run("DELETE FROM login_attempts WHERE key=?", key);
    const value = token(),
      csrf = token(),
      expiresAt = now() + 8 * 60 * 60 * 1000;
    await store.run(
      "INSERT INTO sessions(token_hash,admin_id,csrf,expires_at) VALUES(?,?,?,?)",
      hash(value),
      Number(admin.id),
      csrf,
      expiresAt,
    );
    await audit(email, "login");
    res
      .cookie(cookie, value, { ...options, maxAge: 8 * 60 * 60 * 1000 })
      .json({ user: { email }, csrfToken: csrf, expiresAt });
  });

  app.post("/api/auth/logout", authorize, async (_req, res) => {
    await store.run(
      "DELETE FROM sessions WHERE token_hash=?",
      res.locals.session.token_hash,
    );
    await audit(res.locals.session.email, "logout");
    res.clearCookie(cookie, options).json({ ok: true });
  });

  app.post("/api/auth/password", authorize, async (req, res) => {
    const input = z
      .object({
        currentPassword: z.string().max(1024),
        newPassword: z.string().min(12).max(1024),
      })
      .parse(req.body);
    const admin = (await store.get<{ password_hash: string }>(
      "SELECT * FROM admins WHERE id=?",
      res.locals.session.admin_id,
    ))!;
    if (!(await verify(input.currentPassword, admin.password_hash)))
      return void res
        .status(400)
        .json({ message: "رمز عبور فعلی نادرست است." });
    const encoded = await passwordHash(input.newPassword);
    await store.transaction(async (tx) => {
      await tx.run(
        "UPDATE admins SET password_hash=? WHERE id=?",
        encoded,
        res.locals.session.admin_id,
      );
      await tx.run(
        "DELETE FROM sessions WHERE admin_id=?",
        res.locals.session.admin_id,
      );
      await audit(res.locals.session.email, "password_changed", "", tx);
    });
    res.clearCookie(cookie, options).json({ ok: true });
  });

  app.use("/api/admin", authorize);

  app.get("/api/admin/audit", async (_req, res) => {
    res.json(
      await store.all("SELECT * FROM audit_log ORDER BY id DESC LIMIT 100"),
    );
  });

  app.get("/api/admin/export", async (_req, res) => {
    const reg = await readRegistry();
    res.attachment("geriapharm-registry.json").json({
      schemaVersion: 1,
      exportedAt: new Date(now()).toISOString(),
      medications: reg.medications,
    });
  });

  app.get("/api/admin/survey", async (_req, res) => {
    const responses = await readResponses();
    res.json({ count: responses.length, responses });
  });

  app.get("/api/admin/survey.csv", async (_req, res) => {
    const responses = await readResponses();
    const header = [
      "شناسه",
      "زمان پاسخ",
      "زمان دریافت",
      "سن",
      "جنسیت",
      "شغل",
      ...UMARS_QUESTIONS.map((q) => `سوال ${q.number}: ${q.title}`),
      "تعداد پاسخ‌ها",
      "مجموع امتیاز",
      "میانگین امتیاز",
    ];
    const rows = responses.map((response) => [
      response.id,
      response.createdAt,
      response.receivedAt,
      String(response.demographics.age),
      GENDER_LABELS[response.demographics.gender] ??
        response.demographics.gender,
      OCCUPATION_LABELS[response.demographics.occupation] ??
        response.demographics.occupation,
      ...UMARS_QUESTIONS.map((q) => {
        const score = response.answers[q.id];
        return score === undefined ? "" : String(score);
      }),
      String(response.score.answered),
      String(response.score.total),
      response.score.mean.toFixed(2),
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    res.attachment(
      `geriapharm-umars-${new Date(now()).toISOString().slice(0, 10)}.csv`,
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    // The BOM is what makes Excel read the Persian columns as UTF-8.
    res.send("\uFEFF" + csv + "\r\n");
  });

  app.post("/api/admin/survey/reset", async (_req, res) => {
    const result = await store.run("DELETE FROM survey_responses");
    await audit(res.locals.session.email, "reset_survey", String(result.changes));
    res.json({ ok: true, removed: result.changes });
  });

  app.put("/api/admin/medications/:id", async (req, res) => {
    const drug = drugSchema.parse(req.body);
    if (drug.id !== req.params.id)
      return void res
        .status(400)
        .json({ message: "شناسه دارو با مسیر درخواست یکسان نیست." });
    await updateRegistry(
      req,
      res,
      "save_medication",
      (rows) => {
        const saved = {
          ...drug,
          lastUpdated: new Date(now()).toISOString().slice(0, 10),
        };
        return rows.some((r) => r.id === drug.id)
          ? rows.map((r) => (r.id === drug.id ? saved : r))
          : [...rows, saved];
      },
      drug.id,
    );
  });

  app.delete("/api/admin/medications/:id", async (req, res) => {
    await updateRegistry(
      req,
      res,
      "delete_medication",
      (rows) => rows.filter((r) => r.id !== req.params.id),
      String(req.params.id),
    );
  });

  app.put("/api/admin/registry", async (req, res) => {
    const rows = registrySchema.parse(req.body.medications);
    await updateRegistry(req, res, "import_registry", () => rows);
  });

  app.post("/api/admin/reset", async (req, res) => {
    await updateRegistry(req, res, "reset_registry", () => seedData);
  });

  app.use("/api", (_req, res) =>
    res.status(404).json({ message: "مسیر مورد نظر پیدا نشد." }),
  );

  if (config.serveStatic) {
    app.use(
      express.static(resolve("dist"), {
        index: false,
        setHeaders: (res, path) => {
          res.setHeader(
            "Cache-Control",
            path.includes("/assets/")
              ? "public,max-age=31536000,immutable"
              : "no-cache",
          );
        },
      }),
    );
    app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
  }

  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof z.ZodError)
        return void res.status(400).json({
          message:
            "اطلاعات ارسالی معتبر نیست. فیلدهای الزامی و قالب داده را بررسی کنید.",
          issues: error.issues.map((i) => ({
            path: i.path,
            message: i.message,
          })),
        });
      if (error instanceof SyntaxError)
        return void res.status(400).json({ message: "قالب JSON معتبر نیست." });
      if ((error as { status?: number })?.status === 413)
        return void res
          .status(413)
          .json({ message: "حجم فایل بیش از حد مجاز است." });
      console.error(
        "خطای داخلی سرور:",
        error instanceof Error ? error.message : "unknown",
      );
      res
        .status(500)
        .json({ message: "خطایی در سرور رخ داد. دوباره تلاش کنید." });
    },
  );

  // `db` exposes the SQLite DatabaseSync handle in SQLite mode for backwards
  // compatibility with existing tests; `close()` closes either PostgreSQL or SQLite.
  return { app, db: store.sqlite!, store, close: () => store.close() };
}
