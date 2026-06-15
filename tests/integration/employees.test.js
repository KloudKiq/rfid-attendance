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

describe("POST /api/employees", () => {
  it("creates employee when authenticated", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const res = await agent.post("/api/employees").send({ card_id: "C001", name: "Ahmed", title: "Dev" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toBeDefined();
  });

  it("rejects unauthenticated request", async () => {
    const res = await request(app).post("/api/employees").send({ card_id: "C002", name: "Bob" });
    expect(res.status).toBe(401);
  });

  it("rejects missing card_id", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const res = await agent.post("/api/employees").send({ name: "Charlie" });
    expect(res.status).toBe(400);
  });

  it("rejects missing name", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const res = await agent.post("/api/employees").send({ card_id: "C003" });
    expect(res.status).toBe(400);
  });

  it("rejects duplicate card_id", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    await agent.post("/api/employees").send({ card_id: "C004", name: "First" });
    const res = await agent.post("/api/employees").send({ card_id: "C004", name: "Second" });
    expect(res.status).toBe(409);
  });

  it("trims whitespace from inputs", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const res = await agent.post("/api/employees").send({ card_id: "  C005  ", name: "  Slim  ", title: "  Eng  " });
    expect(res.status).toBe(200);
    const list = await agent.get("/api/employees");
    const emp = list.body.find(e => e.card_id === "C005");
    expect(emp.name).toBe("Slim");
    expect(emp.title).toBe("Eng");
  });

  it("defaults title to empty string", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const res = await agent.post("/api/employees").send({ card_id: "C006", name: "NoTitle" });
    expect(res.status).toBe(200);
    const list = await agent.get("/api/employees");
    const emp = list.body.find(e => e.card_id === "C006");
    expect(emp.title).toBe("");
  });
});

describe("GET /api/employees", () => {
  it("lists employees when authenticated", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin123" });
    const res = await agent.get("/api/employees");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("rejects unauthenticated request", async () => {
    const res = await request(app).get("/api/employees");
    expect(res.status).toBe(401);
  });
});
