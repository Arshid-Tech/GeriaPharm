import { createApp, normalizeOrigins } from "./app";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const production = process.env.NODE_ENV === "production";
const onRender = process.env.RENDER === "true";

const rawOrigins = [
  process.env.APP_ORIGIN,
  onRender ? process.env.RENDER_EXTERNAL_URL : undefined,
]
  .filter(Boolean)
  .join(",");

const origin = rawOrigins || "http://localhost:5173";
const origins = normalizeOrigins(origin);

if (
  production &&
  process.env.COOKIE_SECURE !== "false" &&
  [...origins].some((item) => !item.startsWith("https://"))
) {
  throw new Error("APP_ORIGIN باید نشانی HTTPS سایت باشد.");
}

const { app, close } = await createApp({
  databaseUrl: process.env.DATABASE_URL,
  databasePath: resolve(process.env.DATABASE_PATH ?? "data/geriapharm.sqlite"),
  origin,
  secureCookies: process.env.COOKIE_SECURE === "false" ? false : production,
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD_FILE
    ? readFileSync(process.env.ADMIN_PASSWORD_FILE, "utf8").trim()
    : process.env.ADMIN_PASSWORD,
  serveStatic: production,
  trustProxy: process.env.TRUST_LOOPBACK_PROXY === "true",
  proxyHops:
    process.env.TRUST_PROXY_HOPS === "1" || onRender ? 1 : undefined,
});

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? (onRender || production ? "0.0.0.0" : "127.0.0.1");

const server = app.listen(port, host, () =>
  console.log(`GeriaPharm API: http://${host}:${port}`),
);

for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close(() => {
      void close().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
