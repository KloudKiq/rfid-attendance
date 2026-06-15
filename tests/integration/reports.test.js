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

describe("GET /api/reports", () => {
  it("returns current month when no params", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const res = await agent.get("/api/reports");
    expect(res.status).toBe(200);
    expect(res.body.from).toBeDefined();
    expect(res.body.to).toBeDefined();
    expect(res.body.employees).toBeDefined();
  });

  it("accepts year/month params", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const res = await agent.get("/api/reports?year=2026&month=1");
    expect(res.status).toBe(200);
    expect(res.body.from).toBe("2026-01-01");
    expect(res.body.to).toBe("2026-01-31");
  });

  it("accepts from/to params", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const res = await agent.get("/api/reports?from=2026-03-01&to=2026-03-15");
    expect(res.status).toBe(200);
    expect(res.body.from).toBe("2026-03-01");
    expect(res.body.to).toBe("2026-03-15");
  });

  it("filters by employee_id", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const emp = await createEmployee(agent, { card_id: "RPT001", name: "ReportEmp" });
    insertAttendance(emp.body.id, "IN", 60);
    const res = await agent.get(`/api/reports?from=2020-01-01&to=2030-12-31&employee_id=${emp.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.employees.length).toBe(1);
    expect(res.body.employees[0].emp_id).toBe(emp.body.id);
  });

  it("rejects unauthenticated request", async () => {
    const res = await request(app).get("/api/reports");
    expect(res.status).toBe(401);
  });

  it("rejects invalid employee_id", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const res = await agent.get("/api/reports?employee_id=abc");
    expect(res.status).toBe(400);
  });

  it("returns empty array when no data", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const res = await agent.get("/api/reports?from=1999-01-01&to=1999-01-31");
    expect(res.status).toBe(200);
    expect(res.body.employees).toEqual([]);
  });
});

describe("GET /api/reports/monthly", () => {
  it("redirects to /api/reports", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const res = await agent.get("/api/reports/monthly?year=2026&month=6");
    expect(res.status).toBe(307);
    expect(res.headers.location).toContain("/api/reports?");
  });
});
