import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { setupSuite, loadApp, teardownSuite, createEmployee } from "../setup.js";
import { getDb } from "../setup.js";

let app;

beforeAll(async () => {
  setupSuite();
  ({ app } = await loadApp());
});

afterAll(() => {
  teardownSuite();
});

describe("Concurrent scan scenarios", () => {
  it("5 rapid scans of same card produce only 1 record, rest deduped", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const emp = await createEmployee(agent, { card_id: "CONC001", name: "Conc1" });

    const results = await Promise.all([
      request(app).post("/api/check").send({ card_id: "CONC001" }),
      request(app).post("/api/check").send({ card_id: "CONC001" }),
      request(app).post("/api/check").send({ card_id: "CONC001" }),
      request(app).post("/api/check").send({ card_id: "CONC001" }),
      request(app).post("/api/check").send({ card_id: "CONC001" }),
    ]);

    const fresh = results.filter(r => !r.body.deduplicated);
    const deduped = results.filter(r => r.body.deduplicated);
    expect(fresh.length).toBe(1);
    expect(deduped.length).toBe(4);
    expect(fresh[0].body.type).toBe("IN");

    const db = getDb();
    const count = db.prepare("SELECT COUNT(*) as c FROM attendance WHERE employee_id = ?").get(emp.body.id);
    expect(count.c).toBe(1);
  });

  it("scan at boundary (just under 10s) is deduped", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const emp = await createEmployee(agent, { card_id: "CONC002", name: "Conc2" });
    const db = getDb();
    db.prepare("INSERT INTO attendance(employee_id, type) VALUES (?, 'IN')").run(emp.body.id);
    const nineSecsAgo = new Date(Date.now() - 9000).toISOString().replace("T", " ").slice(0, 19);
    db.prepare("UPDATE attendance SET created_at = ? WHERE employee_id = ?").run(nineSecsAgo, emp.body.id);
    const res = await request(app).post("/api/check").send({ card_id: "CONC002" });
    expect(res.body.deduplicated).toBe(true);
    expect(res.body.type).toBe("IN");
  });

  it("scan at boundary (just over 10s) is fresh", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const emp = await createEmployee(agent, { card_id: "CONC003", name: "Conc3" });
    const db = getDb();
    db.prepare("INSERT INTO attendance(employee_id, type) VALUES (?, 'IN')").run(emp.body.id);
    const tenPointOneSecsAgo = new Date(Date.now() - 10100).toISOString().replace("T", " ").slice(0, 19);
    db.prepare("UPDATE attendance SET created_at = ? WHERE employee_id = ?").run(tenPointOneSecsAgo, emp.body.id);
    const res = await request(app).post("/api/check").send({ card_id: "CONC003" });
    expect(res.body.deduplicated).toBeUndefined();
    expect(res.body.type).toBe("OUT");
  });
});
