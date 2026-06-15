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

describe("GET /api/today", () => {
  it("rejects unauthenticated request", async () => {
    const res = await request(app).get("/api/today");
    expect(res.status).toBe(401);
  });

  it("returns empty array on empty day", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const res = await agent.get("/api/today");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("returns records after check-in", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const emp = await createEmployee(agent, { card_id: "TOD001", name: "Today1" });
    await request(app).post("/api/check").send({ card_id: "TOD001" });
    const res = await agent.get("/api/today");
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].name).toBe("Today1");
  });

  it("orders by id descending", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const emp1 = await createEmployee(agent, { card_id: "TOD002", name: "Today2" });
    const emp2 = await createEmployee(agent, { card_id: "TOD003", name: "Today3" });
    await request(app).post("/api/check").send({ card_id: "TOD002" });
    await request(app).post("/api/check").send({ card_id: "TOD003" });
    const res = await agent.get("/api/today");
    const names = res.body.map(r => r.name);
    const idx2 = names.indexOf("Today2");
    const idx3 = names.indexOf("Today3");
    expect(idx3).toBeLessThan(idx2);
  });
});
