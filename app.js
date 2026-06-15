import express from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";

const app = express();
const dbPath = process.env.DB_PATH || "attendance.db";
const db = new Database(dbPath);

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "admin123";

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  title TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('IN','OUT')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(employee_id) REFERENCES employees(id)
);
`);

const hasAdmin = db.prepare("SELECT id FROM admins LIMIT 1").get();
if (!hasAdmin) {
  db.prepare("INSERT INTO admins(username, password_hash) VALUES (?, ?)")
    .run(ADMIN_USER, bcrypt.hashSync(ADMIN_PASS, 10));
  console.log(`Default admin created: ${ADMIN_USER} / ${ADMIN_PASS}`);
}

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-secret",
  resave: false,
  saveUninitialized: false
}));
app.use(express.static("public"));

function requireAuth(req, res, next) {
  if (req.session.admin) return next();
  res.status(401).json({ error: "UNAUTHORIZED" });
}

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare("SELECT * FROM admins WHERE username=?").get(username);
  if (!admin || !bcrypt.compareSync(password || "", admin.password_hash)) {
    return res.status(401).json({ error: "بيانات الدخول غير صحيحة" });
  }
  req.session.admin = { id: admin.id, username: admin.username };
  res.json({ ok: true, username: admin.username });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => {
  res.json({ loggedIn: !!req.session.admin, admin: req.session.admin || null });
});

app.post("/api/employees", requireAuth, (req, res) => {
  const card_id = String(req.body.card_id || "").trim();
  const name = String(req.body.name || "").trim();
  const title = String(req.body.title || "").trim();

  if (!card_id || !name) return res.status(400).json({ error: "رقم البطاقة والاسم مطلوبان" });

  try {
    const result = db.prepare("INSERT INTO employees(card_id, name, title) VALUES (?, ?, ?)")
      .run(card_id, name, title);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch {
    res.status(409).json({ error: "هذه البطاقة معرفة مسبقًا" });
  }
});

app.get("/api/employees", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, card_id, name, title, active, created_at
    FROM employees
    ORDER BY id DESC
  `).all();
  res.json(rows);
});

const CARD_COOLDOWN_SECONDS = 10;

app.post("/api/check", (req, res) => {
  const card_id = String(req.body.card_id || "").trim();
  if (!card_id) return res.status(400).json({ error: "لا يوجد رقم بطاقة" });

  const emp = db.prepare("SELECT * FROM employees WHERE card_id=? AND active=1").get(card_id);
  if (!emp) return res.status(404).json({ error: "بطاقة غير معرفة", card_id });

  const last = db.prepare(`
    SELECT type, created_at FROM attendance
    WHERE employee_id=?
    ORDER BY id DESC LIMIT 1
  `).get(emp.id);

  if (last) {
    const secondsSinceLast =
      (Date.now() - new Date(last.created_at.replace(" ", "T") + "Z").getTime()) / 1000;
    if (secondsSinceLast < CARD_COOLDOWN_SECONDS) {
      return res.json({
        ok: true,
        type: last.type,
        employee: { id: emp.id, name: emp.name, title: emp.title },
        time: new Date().toLocaleString(),
        deduplicated: true
      });
    }
  }

  const nextType = last?.type === "IN" ? "OUT" : "IN";
  db.prepare("INSERT INTO attendance(employee_id, type) VALUES (?, ?)").run(emp.id, nextType);

  res.json({
    ok: true,
    type: nextType,
    employee: { id: emp.id, name: emp.name, title: emp.title },
    time: new Date().toLocaleString()
  });
});

app.get("/api/reports", requireAuth, (req, res) => {
  let from, to;
  if (req.query.from && req.query.to) {
    from = String(req.query.from).slice(0, 10);
    to   = String(req.query.to).slice(0, 10);
  } else {
    const year  = String(req.query.year  || new Date().getFullYear()).padStart(4, "0");
    const month = String(req.query.month || new Date().getMonth() + 1).padStart(2, "0");
    const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
    from = `${year}-${month}-01`;
    to   = `${year}-${month}-${String(lastDay).padStart(2, "0")}`;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: "تنسيق التاريخ غير صحيح (YYYY-MM-DD)" });
  }

  const empId = req.query.employee_id ? parseInt(req.query.employee_id, 10) : null;
  if (req.query.employee_id && isNaN(empId)) {
    return res.status(400).json({ error: "معرّف الموظف غير صحيح" });
  }

  const params = [from, to];
  const empFilter = empId ? "AND e.id = ?" : "";
  if (empId) params.push(empId);

  const days = db.prepare(`
    SELECT
      e.id          AS emp_id,
      e.name,
      e.title,
      e.card_id,
      date(a.created_at, 'localtime')                                       AS day,
      MIN(CASE WHEN a.type='IN'  THEN time(a.created_at,'localtime') END)  AS first_in,
      MAX(CASE WHEN a.type='OUT' THEN time(a.created_at,'localtime') END)  AS last_out
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    WHERE date(a.created_at, 'localtime') BETWEEN ? AND ?
    ${empFilter}
    GROUP BY e.id, day
    ORDER BY e.name, day
  `).all(...params);

  const map = new Map();
  for (const r of days) {
    if (!map.has(r.emp_id)) {
      map.set(r.emp_id, { emp_id: r.emp_id, name: r.name, title: r.title, card_id: r.card_id, days: [] });
    }
    map.get(r.emp_id).days.push({ day: r.day, first_in: r.first_in, last_out: r.last_out });
  }

  res.json({
    from, to,
    employees: [...map.values()].map(e => ({ ...e, total_days: e.days.length }))
  });
});

app.get("/api/reports/monthly", requireAuth, (req, res) => {
  res.redirect(307, `/api/reports?${new URLSearchParams(req.query)}`);
});

app.get("/api/today", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT a.id, e.name, e.title, e.card_id, a.type, a.created_at
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    WHERE date(a.created_at, 'localtime') = date('now', 'localtime')
    ORDER BY a.id DESC
    LIMIT 100
  `).all();
  res.json(rows);
});

export { app, db };
