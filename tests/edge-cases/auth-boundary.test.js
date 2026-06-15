import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { setupSuite, loadApp, teardownSuite } from "../setup.js";

let app;

beforeAll(async () => {
  setupSuite();
  ({ app } = await loadApp());
});

afterAll(() => {
  teardownSuite();
});

describe("Auth boundary tests", () => {
  it("GET /api/employees without auth → 401", async () => {
    const res = await request(app).get("/api/employees");
    expect(res.status).toBe(401);
  });

  it("POST /api/employees without auth → 401", async () => {
    const res = await request(app).post("/api/employees").send({ card_id: "X", name: "Y" });
    expect(res.status).toBe(401);
  });

  it("GET /api/today without auth → 401", async () => {
    const res = await request(app).get("/api/today");
    expect(res.status).toBe(401);
  });

  it("GET /api/reports without auth → 401", async () => {
    const res = await request(app).get("/api/reports");
    expect(res.status).toBe(401);
  });

  it("GET /api/reports/monthly without auth → 401", async () => {
    const res = await request(app).get("/api/reports/monthly");
    expect(res.status).toBe(401);
  });

  it("POST /api/check without auth → NOT 401 (public)", async () => {
    const res = await request(app).post("/api/check").send({ card_id: "NOPE" });
    expect(res.status).not.toBe(401);
  });

  it("POST /api/login without auth → NOT 401 (public)", async () => {
    const res = await request(app).post("/api/login").send({ username: "admin", password: "admin123" });
    expect(res.status).not.toBe(401);
  });

  it("GET /api/me without auth → NOT 401 (public)", async () => {
    const res = await request(app).get("/api/me");
    expect(res.status).not.toBe(401);
  });
});
