import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { setupSuite, loadApp, teardownSuite, createEmployee, insertAttendanceRaw } from "../setup.js";
import { getDb } from "../setup.js";

let app;

beforeAll(async () => {
  setupSuite();
  ({ app } = await loadApp());
});

afterAll(() => {
  teardownSuite();
});

function isoMinus(seconds) {
  const d = new Date(Date.now() - seconds * 1000);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

describe("IN/OUT alternation", () => {
  it("no prior records returns IN", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const emp = await createEmployee(agent, { card_id: "ALT001", name: "Alt1" });
    const res = await request(app).post("/api/check").send({ card_id: "ALT001" });
    expect(res.body.type).toBe("IN");
  });

  it("last IN returns OUT", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const emp = await createEmployee(agent, { card_id: "ALT002", name: "Alt2" });
    const db = getDb();
    db.prepare("INSERT INTO attendance(employee_id, type) VALUES (?, 'IN')").run(emp.body.id);
    db.prepare("UPDATE attendance SET created_at = ? WHERE employee_id = ?").run(isoMinus(20), emp.body.id);
    const res = await request(app).post("/api/check").send({ card_id: "ALT002" });
    expect(res.body.type).toBe("OUT");
  });

  it("last OUT returns IN", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const emp = await createEmployee(agent, { card_id: "ALT003", name: "Alt3" });
    const db = getDb();
    db.prepare("INSERT INTO attendance(employee_id, type) VALUES (?, 'OUT')").run(emp.body.id);
    db.prepare("UPDATE attendance SET created_at = ? WHERE employee_id = ?").run(isoMinus(20), emp.body.id);
    const res = await request(app).post("/api/check").send({ card_id: "ALT003" });
    expect(res.body.type).toBe("IN");
  });

  it("multiple alternations work correctly", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const emp = await createEmployee(agent, { card_id: "ALT004", name: "Alt4" });
    const db = getDb();
    const types = ["IN", "OUT", "IN", "OUT", "IN"];
    for (const t of types) {
      db.prepare("INSERT INTO attendance(employee_id, type) VALUES (?, ?)").run(emp.body.id, t);
      db.prepare("UPDATE attendance SET created_at = ? WHERE employee_id = ? AND type = ?").run(isoMinus(20), emp.body.id, t);
    }
    const res = await request(app).post("/api/check").send({ card_id: "ALT004" });
    expect(res.body.type).toBe("OUT");
  });
});
