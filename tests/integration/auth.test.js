import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { setupSuite, loadApp, teardownSuite, createEmployee, insertAttendance } from "../setup.js";

let app;

beforeAll(async () => {
  setupSuite();
  ({ app } = await loadApp());
});

afterAll(() => {
  teardownSuite();
});

describe("POST /api/login", () => {
  it("logs in with correct credentials", async () => {
    const res = await request(app).post("/api/login").send({ username: "admin", password: "admin123" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.username).toBe("admin");
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("rejects wrong password", async () => {
    const res = await request(app).post("/api/login").send({ username: "admin", password: "wrong" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it("rejects missing fields", async () => {
    const res = await request(app).post("/api/login").send({});
    expect(res.status).toBe(401);
  });

  it("rejects nonexistent user", async () => {
    const res = await request(app).post("/api/login").send({ username: "nobody", password: "x" });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/me", () => {
  it("returns loggedIn=false when not logged in", async () => {
    const res = await request(app).get("/api/me");
    expect(res.status).toBe(200);
    expect(res.body.loggedIn).toBe(false);
    expect(res.body.admin).toBeNull();
  });

  it("returns loggedIn=true after login", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const res = await agent.get("/api/me");
    expect(res.status).toBe(200);
    expect(res.body.loggedIn).toBe(true);
    expect(res.body.admin.username).toBe("admin");
  });
});

describe("POST /api/logout", () => {
  it("destroys session", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const meBefore = await agent.get("/api/me");
    expect(meBefore.body.loggedIn).toBe(true);

    await agent.post("/api/logout");
    const meAfter = await agent.get("/api/me");
    expect(meAfter.body.loggedIn).toBe(false);
  });
});
