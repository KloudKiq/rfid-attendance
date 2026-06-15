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

describe("Cooldown deduplication", () => {
  it("first scan returns IN", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const emp = await createEmployee(agent, { card_id: "CD001", name: "Cooldown1" });
    const res = await request(app).post("/api/check").send({ card_id: "CD001" });
    expect(res.body.type).toBe("IN");
    expect(res.body.deduplicated).toBeUndefined();
  });

  it("scan within 10s is deduped", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const emp = await createEmployee(agent, { card_id: "CD002", name: "Cooldown2" });
    const db = getDb();
    db.prepare("INSERT INTO attendance(employee_id, type) VALUES (?, 'IN')").run(emp.body.id);
    db.prepare("UPDATE attendance SET created_at = ? WHERE employee_id = ?").run(isoMinus(5), emp.body.id);
    const res = await request(app).post("/api/check").send({ card_id: "CD002" });
    expect(res.body.type).toBe("IN");
    expect(res.body.deduplicated).toBe(true);
  });

  it("scan after 10s returns opposite type", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const emp = await createEmployee(agent, { card_id: "CD003", name: "Cooldown3" });
    const db = getDb();
    db.prepare("INSERT INTO attendance(employee_id, type) VALUES (?, 'IN')").run(emp.body.id);
    db.prepare("UPDATE attendance SET created_at = ? WHERE employee_id = ?").run(isoMinus(15), emp.body.id);
    const res = await request(app).post("/api/check").send({ card_id: "CD003" });
    expect(res.body.type).toBe("OUT");
    expect(res.body.deduplicated).toBeUndefined();
  });

  it("different cards don't share cooldown", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const emp1 = await createEmployee(agent, { card_id: "CD004", name: "CardA" });
    const emp2 = await createEmployee(agent, { card_id: "CD005", name: "CardB" });
    await request(app).post("/api/check").send({ card_id: "CD004" });
    const res2 = await request(app).post("/api/check").send({ card_id: "CD005" });
    expect(res2.body.type).toBe("IN");
    expect(res2.body.deduplicated).toBeUndefined();
  });

  it("three scans: IN, dedup, then OUT", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const emp = await createEmployee(agent, { card_id: "CD006", name: "ThreeScan" });
    const r1 = await request(app).post("/api/check").send({ card_id: "CD006" });
    expect(r1.body.type).toBe("IN");
    const r2 = await request(app).post("/api/check").send({ card_id: "CD006" });
    expect(r2.body.type).toBe("IN");
    expect(r2.body.deduplicated).toBe(true);
    const db = getDb();
    db.prepare("UPDATE attendance SET created_at = ? WHERE employee_id = ?").run(isoMinus(15), emp.body.id);
    const r3 = await request(app).post("/api/check").send({ card_id: "CD006" });
    expect(r3.body.type).toBe("OUT");
  });
});
