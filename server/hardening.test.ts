import { afterEach, describe, it, expect } from "vitest";
import supertest from "supertest";
import { createApp, csvCell, normalizeOrigins } from "./app";

const instances: Awaited<ReturnType<typeof createApp>>[] = [];
afterEach(async () => {
  for (const i of instances.splice(0)) await i.close();
});

describe("backend hardening helpers and rate-limit configuration", () => {
  it("neutralizes spreadsheet formula prefixes in CSV cells", () => {
    expect(csvCell("=CMD|' /C calc'!A0")).toBe("'=CMD|' /C calc'!A0");
    expect(csvCell("+SUM(A1:A2)")).toBe("'+SUM(A1:A2)");
    expect(csvCell("-1+1")).toBe("'-1+1");
    expect(csvCell("@SUM(1,2)")).toBe(`"'@SUM(1,2)"`);
    expect(csvCell("داروساز")).toBe("داروساز");
    expect(csvCell('متن با "نقل‌قول" و, ویرگول')).toBe(
      '"متن با ""نقل‌قول"" و, ویرگول"',
    );
  });

  it("normalizes comma-separated origins and strips trailing slashes", () => {
    const origins = normalizeOrigins(
      " https://geriapharm.arshid.tech/ , https://geriapharm.onrender.com/// ",
    );
    expect(origins.has("https://geriapharm.arshid.tech")).toBe(true);
    expect(origins.has("https://geriapharm.onrender.com")).toBe(true);
    expect(origins.size).toBe(2);
  });

  it("respects custom surveyRateLimit and loginIpRateLimit values", async () => {
    const origin = "https://geriapharm.arshid.tech";
    const instance = await createApp({
      databasePath: ":memory:",
      origin,
      secureCookies: false,
      adminEmail: "admin@example.test",
      adminPassword: "Strong-test-password-987!",
      surveyRateLimit: 2,
      loginIpRateLimit: 2,
    });
    instances.push(instance);
    const agent = supertest.agent(instance.app);

    for (let i = 0; i < 2; i += 1) {
      const res = await agent
        .post("/api/survey")
        .set("Origin", origin)
        .send({
          id: `00000000-0000-4000-8000-00000000000${i}`,
          createdAt: new Date(Date.now() - 10_000).toISOString(),
          demographics: { age: 35, gender: "male", occupation: "physician" },
          answers: { q1: 5 },
        });
      expect(res.status).toBe(201);
    }

    const blockedSurvey = await agent
      .post("/api/survey")
      .set("Origin", origin)
      .send({
        id: "00000000-0000-4000-8000-000000000009",
        createdAt: new Date(Date.now() - 10_000).toISOString(),
        demographics: { age: 35, gender: "male", occupation: "physician" },
        answers: { q1: 5 },
      });
    expect(blockedSurvey.status).toBe(429);

    for (let i = 0; i < 2; i += 1) {
      const res = await agent
        .post("/api/auth/login")
        .set("Origin", origin)
        .send({ email: "admin@example.test", password: "wrong-password" });
      expect(res.status).toBe(401);
    }

    const blockedLogin = await agent
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email: "admin@example.test", password: "Strong-test-password-987!" });
    expect(blockedLogin.status).toBe(429);
  });
});
