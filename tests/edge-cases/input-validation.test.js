import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { setupSuite, loadApp, teardownSuite, createEmployee } from "../setup.js";

let app;

beforeAll(async () => {
  setupSuite();
  ({ app } = await loadApp());
});

afterAll(() => {
  teardownSuite();
});

describe("Input validation edge cases", () => {
  it("POST /api/check with no body returns 400", async () => {
    const res = await request(app).post("/api/check").send({});
    expect(res.status).toBe(400);
  });

  it("POST /api/check with card_id=0 is valid (falsy string but non-empty)", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const emp = await createEmployee(agent, { card_id: "0", name: "ZeroCard" });
    const res = await request(app).post("/api/check").send({ card_id: "0" });
    expect(res.status).toBe(200);
  });

  it("POST /api/employees with empty card_id returns 400", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const res = await agent.post("/api/employees").send({ card_id: "", name: "Test" });
    expect(res.status).toBe(400);
  });

  it("POST /api/employees with whitespace-only name returns 400", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const res = await agent.post("/api/employees").send({ card_id: "EV001", name: "   " });
    expect(res.status).toBe(400);
  });

  it("GET /api/reports with invalid from date returns 400", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const res = await agent.get("/api/reports?from=not-a-date&to=2026-01-01");
    expect(res.status).toBe(400);
  });

  it("GET /api/reports with non-numeric employee_id returns 400", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const res = await agent.get("/api/reports?employee_id=abc");
    expect(res.status).toBe(400);
  });

  it("POST /api/check with whitespace-only card_id returns 400", async () => {
    const res = await request(app).post("/api/check").send({ card_id: "   " });
    expect(res.status).toBe(400);
  });
});
