import { vi } from "vitest";
import request from "supertest";
import fs from "fs";

let testDbPath;
let app;
let db;

export function setupSuite() {
  testDbPath = `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  process.env.DB_PATH = testDbPath;
  vi.resetModules();
}

export async function loadApp() {
  const mod = await import("../app.js");
  app = mod.app;
  db = mod.db;
  return { app, db };
}

export function teardownSuite() {
  if (db) {
    try { db.close(); } catch {}
  }
  if (testDbPath && fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
}

export function getApp() {
  return app;
}

export function getDb() {
  return db;
}

export async function loginAgent(agent) {
  const res = await agent.post("/api/login").send({ username: "admin", password: "admin123" });
  return res;
}

export async function createEmployee(agent, data = {}) {
  return agent.post("/api/employees").send({
    card_id: data.card_id || `CARD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: data.name || `Employee ${Date.now()}`,
    title: data.title || "Staff",
  });
}

export async function scanCard(agent, cardId) {
  return agent.post("/api/check").send({ card_id: cardId });
}

export function insertAttendance(empId, type, minutesAgo = 60) {
  db.prepare(
    "INSERT INTO attendance(employee_id, type, created_at) VALUES (?, ?, datetime('now', ?))"
  ).run(empId, type, `-${minutesAgo} minutes`);
}

export function insertAttendanceRaw(empId, type, createdAt) {
  db.prepare(
    "INSERT INTO attendance(employee_id, type, created_at) VALUES (?, ?, ?)"
  ).run(empId, type, createdAt);
}
