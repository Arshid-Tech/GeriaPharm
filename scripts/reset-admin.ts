import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { passwordHash } from "../server/app";
import { createDatabaseStore } from "../server/db";

const email = process.env.ADMIN_EMAIL,
  password = process.env.ADMIN_PASSWORD_FILE
    ? readFileSync(process.env.ADMIN_PASSWORD_FILE, "utf8").trim()
    : process.env.ADMIN_PASSWORD;

if (!email || !password || password.length < 12)
  throw new Error("ADMIN_EMAIL و ADMIN_PASSWORD با حداقل ۱۲ نویسه لازم است.");

const store = await createDatabaseStore({
  databaseUrl: process.env.DATABASE_URL,
  databasePath: resolve(process.env.DATABASE_PATH ?? "data/geriapharm.sqlite"),
});

try {
  const encoded = await passwordHash(password);
  const normalizedEmail = email.toLowerCase();
  await store.transaction(async (tx) => {
    const result = await tx.run(
      "UPDATE admins SET password_hash=? WHERE email=?",
      encoded,
      normalizedEmail,
    );
    if (!result.changes) throw new Error("مدیر پیدا نشد.");
    await tx.run(
      "DELETE FROM sessions WHERE admin_id IN(SELECT id FROM admins WHERE email=?)",
      normalizedEmail,
    );
  });
  console.log("رمز عبور بازنشانی شد و نشست‌های قبلی بسته شدند.");
} finally {
  await store.close();
}
