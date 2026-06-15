import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { setupSuite, loadApp, teardownSuite, createEmployee, insertAttendance, insertAttendanceRaw } from "../setup.js";
import { getDb } from "../setup.js";

let app;

beforeAll(async () => {
  setupSuite();
  ({ app } = await loadApp());
});

afterAll(() => {
  teardownSuite();
});

describe("POST /api/check", () => {
  it("first scan returns IN", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const emp = await createEmployee(agent, { card_id: "CHK001", name: "Check1" });
    const res = await request(app).post("/api/check").send({ card_id: "CHK001" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.type).toBe("IN");
    expect(res.body.employee.name).toBe("Check1");
    expect(res.body.deduplicated).toBeUndefined();
  });

  it("second scan after 10s returns OUT", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const emp = await createEmployee(agent, { card_id: "CHK002", name: "Check2" });
    const db = getDb();
    db.prepare("INSERT INTO attendance(employee_id, type) VALUES (?, 'IN')").run(emp.body.id);
    db.prepare("UPDATE attendance SET created_at = datetime('now', '-20 minutes') WHERE employee_id = ?").run(emp.body.id);
    const res = await request(app).post("/api/check").send({ card_id: "CHK002" });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("OUT");
  });

  it("returns 404 for unknown card", async () => {
    const res = await request(app).post("/api/check").send({ card_id: "UNKNOWN" });
    expect(res.status).toBe(404);
  });

  it("returns 400 for empty card_id", async () => {
    const res = await request(app).post("/api/check").send({});
    expect(res.status).toBe(400);
  });

  it("returns 404 for inactive employee", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const emp = await createEmployee(agent, { card_id: "CHK003", name: "Inactive" });
    const db = getDb();
    db.prepare("UPDATE employees SET active = 0 WHERE card_id = 'CHK003'").run();
    const res = await request(app).post("/api/check").send({ card_id: "CHK003" });
    expect(res.status).toBe(404);
  });

  it("includes employee info in response", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const emp = await createEmployee(agent, { card_id: "CHK004", name: "Info", title: "Manager" });
    const res = await request(app).post("/api/check").send({ card_id: "CHK004" });
    expect(res.body.employee).toEqual({ id: emp.body.id, name: "Info", title: "Manager" });
  });
});
