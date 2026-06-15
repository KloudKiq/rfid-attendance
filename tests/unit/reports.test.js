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

describe("Report date filtering", () => {
  it("returns records within from/to range", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const emp = await createEmployee(agent, { card_id: "RPTU01", name: "RptUnit1" });
    const db = getDb();
    db.prepare("INSERT INTO attendance(employee_id, type, created_at) VALUES (?, 'IN', '2026-03-10 09:00:00')").run(emp.body.id);
    db.prepare("INSERT INTO attendance(employee_id, type, created_at) VALUES (?, 'OUT', '2026-03-10 17:00:00')").run(emp.body.id);
    db.prepare("INSERT INTO attendance(employee_id, type, created_at) VALUES (?, 'IN', '2026-04-05 09:00:00')").run(emp.body.id);
    const res = await agent.get("/api/reports?from=2026-03-01&to=2026-03-31");
    expect(res.status).toBe(200);
    expect(res.body.employees.length).toBe(1);
    expect(res.body.employees[0].days.length).toBe(1);
    expect(res.body.employees[0].days[0].day).toBe("2026-03-10");
  });

  it("leap year February has 29 days", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const res = await agent.get("/api/reports?year=2028&month=2");
    expect(res.body.from).toBe("2028-02-01");
    expect(res.body.to).toBe("2028-02-29");
  });

  it("aggregates same-day scans correctly", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const emp = await createEmployee(agent, { card_id: "RPTU02", name: "RptUnit2" });
    const db = getDb();
    const tzOffset = -new Date().getTimezoneOffset() / 60;
    const pad = (n) => String(n).padStart(2, "0");
    const localTime = (h, m) => {
      const totalMin = ((h * 60 + m) + tzOffset * 60 + 1440) % 1440;
      return `${pad(Math.floor(totalMin / 60))}:${pad(totalMin % 60)}:00`;
    };
    db.prepare("INSERT INTO attendance(employee_id, type, created_at) VALUES (?, 'IN', '2026-06-15 08:30:00')").run(emp.body.id);
    db.prepare("INSERT INTO attendance(employee_id, type, created_at) VALUES (?, 'IN', '2026-06-15 09:00:00')").run(emp.body.id);
    db.prepare("INSERT INTO attendance(employee_id, type, created_at) VALUES (?, 'OUT', '2026-06-15 17:00:00')").run(emp.body.id);
    db.prepare("INSERT INTO attendance(employee_id, type, created_at) VALUES (?, 'OUT', '2026-06-15 17:30:00')").run(emp.body.id);
    const res = await agent.get("/api/reports?from=2026-06-15&to=2026-06-15");
    const day = res.body.employees[0].days[0];
    expect(day.first_in).toBe(localTime(8, 30));
    expect(day.last_out).toBe(localTime(17, 30));
  });

  it("invalid date format returns 400", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const res = await agent.get("/api/reports?from=not-a-date&to=2026-01-01");
    expect(res.status).toBe(400);
  });

  it("NaN employee_id returns 400", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const res = await agent.get("/api/reports?employee_id=abc");
    expect(res.status).toBe(400);
  });

  it("returns total_days count", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const emp = await createEmployee(agent, { card_id: "RPTU03", name: "RptUnit3" });
    const db = getDb();
    db.prepare("INSERT INTO attendance(employee_id, type, created_at) VALUES (?, 'IN', '2026-06-01 12:00:00')").run(emp.body.id);
    db.prepare("INSERT INTO attendance(employee_id, type, created_at) VALUES (?, 'IN', '2026-06-10 12:00:00')").run(emp.body.id);
    const res = await agent.get("/api/reports?from=2026-06-01&to=2026-06-30");
    const empData = res.body.employees.find(e => e.emp_id === emp.body.id);
    expect(empData).toBeDefined();
    expect(empData.total_days).toBe(2);
  });
});
