import express from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { hidAvailable, hidLoadError, listDevices, RFIDReader } from "./rfid-reader.js";
import { serialAvailable, serialLoadError, listSerialPorts, SerialRFIDReader } from "./serial-reader.js";

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

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
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

// ── Settings helpers ──────────────────────────────────────────────────────
function getSetting(key) {
  return db.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value ?? null;
}
function setSetting(key, value) {
  db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES (?,?)").run(key, String(value));
}
function deleteSetting(key) {
  db.prepare("DELETE FROM settings WHERE key=?").run(key);
}

// ── SSE broadcast ─────────────────────────────────────────────────────────
const sseClients = new Set();

function broadcastSSE(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch {}
  }
}

// Keep connections alive through proxies
setInterval(() => {
  for (const res of sseClients) {
    try { res.write(': heartbeat\n\n'); } catch {}
  }
}, 25000);

// The kiosk enters "server mode" (auto-scan) whenever EITHER reader is active.
function _broadcastReaderStatus() {
  broadcastSSE({ type: 'status', active: reader.isOpen || serialReader.isOpen });
}

// ── RFID reader (HID keyboard-emulating) ──────────────────────────────────
const reader = new RFIDReader();
let _retryTimer = null;

reader.on('card', card_id => {
  const result = processCard(card_id);
  broadcastSSE({ type: 'scan', ...result });
});

reader.on('error', err => {
  console.error('RFID reader disconnected:', err.message);
  _broadcastReaderStatus();
  _scheduleRetry();
});

function _openReader(vendorId, productId) {
  clearTimeout(_retryTimer);
  reader.open(vendorId, productId);
  _broadcastReaderStatus();
  console.log(`RFID reader opened: VID=0x${vendorId.toString(16)} PID=0x${productId.toString(16)}`);
}

function _closeReader() {
  clearTimeout(_retryTimer);
  reader.close();
  _broadcastReaderStatus();
}

function _scheduleRetry() {
  const vid = getSetting('rfid_vendor_id');
  const pid = getSetting('rfid_product_id');
  if (!vid || !pid) return;
  clearTimeout(_retryTimer);
  _retryTimer = setTimeout(() => {
    if (!reader.isOpen) {
      try { _openReader(+vid, +pid); } catch {}
      _scheduleRetry();
    }
  }, 5000);
}

// ── RFID reader (serial / USB-CDC) ────────────────────────────────────────
// Works server-side on macOS and Windows, where keyboard-type HID readers
// cannot be opened (the OS seizes the keyboard device).
const serialReader = new SerialRFIDReader();
let _serialRetryTimer = null;

serialReader.on('card', card_id => {
  const result = processCard(card_id);
  broadcastSSE({ type: 'scan', ...result });
});

serialReader.on('error', err => {
  console.error('Serial RFID reader disconnected:', err.message);
  _broadcastReaderStatus();
  _scheduleSerialRetry();
});

// Returns the open Promise so callers (e.g. /api/serial/select) can await it.
function _openSerial(path, baudRate) {
  clearTimeout(_serialRetryTimer);
  return serialReader.open(path, baudRate).then(() => {
    _broadcastReaderStatus();
    console.log(`Serial RFID reader opened: ${path} @ ${baudRate} baud`);
  });
}

function _closeSerial() {
  clearTimeout(_serialRetryTimer);
  serialReader.close();
  _broadcastReaderStatus();
}

function _scheduleSerialRetry() {
  const path = getSetting('rfid_serial_path');
  const baud = getSetting('rfid_serial_baud');
  if (!path) return;
  clearTimeout(_serialRetryTimer);
  _serialRetryTimer = setTimeout(() => {
    if (!serialReader.isOpen) {
      _openSerial(path, +baud || 9600).catch(() => {});
      _scheduleSerialRetry();
    }
  }, 5000);
}

// Auto-open saved readers on startup
{
  const vid = getSetting('rfid_vendor_id');
  const pid = getSetting('rfid_product_id');
  if (vid && pid) {
    try { _openReader(+vid, +pid); }
    catch (e) { console.error('RFID auto-open failed:', e.message); _scheduleRetry(); }
  }

  const sPath = getSetting('rfid_serial_path');
  const sBaud = getSetting('rfid_serial_baud');
  if (sPath) {
    _openSerial(sPath, +sBaud || 9600)
      .catch(e => { console.error('Serial auto-open failed:', e.message); _scheduleSerialRetry(); });
  }
}

// ── Card processing (shared by HTTP + HID paths) ──────────────────────────
const CARD_COOLDOWN_SECONDS = 10;

function processCard(card_id) {
  const emp = db.prepare("SELECT * FROM employees WHERE card_id=? AND active=1").get(card_id);
  if (!emp) return { ok: false, error: "بطاقة غير معرفة", card_id };

  const last = db.prepare(`
    SELECT type, created_at FROM attendance
    WHERE employee_id=?
    ORDER BY id DESC LIMIT 1
  `).get(emp.id);

  if (last) {
    const secs =
      (Date.now() - new Date(last.created_at.replace(" ", "T") + "Z").getTime()) / 1000;
    if (secs < CARD_COOLDOWN_SECONDS) {
      return {
        ok: true, type: last.type,
        employee: { id: emp.id, name: emp.name, title: emp.title },
        time: new Date().toLocaleString(), deduplicated: true
      };
    }
  }

  const nextType = last?.type === "IN" ? "OUT" : "IN";
  db.prepare("INSERT INTO attendance(employee_id, type) VALUES (?, ?)").run(emp.id, nextType);
  return {
    ok: true, type: nextType,
    employee: { id: emp.id, name: emp.name, title: emp.title },
    time: new Date().toLocaleString()
  };
}

// ── Auth ──────────────────────────────────────────────────────────────────
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

// ── Employees ─────────────────────────────────────────────────────────────
app.post("/api/employees", requireAuth, (req, res) => {
  const card_id = String(req.body.card_id || "").trim();
  const name    = String(req.body.name    || "").trim();
  const title   = String(req.body.title   || "").trim();

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

// ── Attendance ────────────────────────────────────────────────────────────
app.post("/api/check", (req, res) => {
  const card_id = String(req.body.card_id || "").trim();
  if (!card_id) return res.status(400).json({ error: "لا يوجد رقم بطاقة" });
  const result = processCard(card_id);
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
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

// ── RFID device management ────────────────────────────────────────────────
app.get("/api/devices", requireAuth, (req, res) => {
  const showAll = req.query.all === 'true';
  res.json({
    available: hidAvailable,
    loadError: hidLoadError || null,
    devices: listDevices(showAll),
  });
});

app.get("/api/devices/status", (req, res) => {
  res.json({
    available: hidAvailable,
    active:    reader.isOpen,
    vendorId:  reader.vendorId  ?? null,
    productId: reader.productId ?? null,
  });
});

app.post("/api/devices/select", requireAuth, (req, res) => {
  const vendorId  = parseInt(req.body.vendorId,  10);
  const productId = parseInt(req.body.productId, 10);
  if (isNaN(vendorId) || isNaN(productId)) {
    return res.status(400).json({ error: "vendorId و productId مطلوبان" });
  }
  try {
    _openReader(vendorId, productId);
    setSetting('rfid_vendor_id',  vendorId);
    setSetting('rfid_product_id', productId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/devices/select", requireAuth, (req, res) => {
  _closeReader();
  deleteSetting('rfid_vendor_id');
  deleteSetting('rfid_product_id');
  res.json({ ok: true });
});

// ── Serial (USB-CDC) reader management ─────────────────────────────────────
app.get("/api/serial/ports", requireAuth, async (req, res) => {
  res.json({
    available: serialAvailable,
    loadError: serialLoadError || null,
    ports:     await listSerialPorts(),
  });
});

app.get("/api/serial/status", (req, res) => {
  res.json({
    available: serialAvailable,
    active:    serialReader.isOpen,
    path:      serialReader.path     ?? null,
    baudRate:  serialReader.baudRate ?? null,
  });
});

app.post("/api/serial/select", requireAuth, async (req, res) => {
  const path     = String(req.body.path || "").trim();
  const baudRate = req.body.baudRate != null ? parseInt(req.body.baudRate, 10) : 9600;
  if (!path)                            return res.status(400).json({ error: "مسار المنفذ مطلوب" });
  if (isNaN(baudRate) || baudRate <= 0) return res.status(400).json({ error: "معدل الباود غير صحيح" });
  try {
    await _openSerial(path, baudRate);
    setSetting('rfid_serial_path', path);
    setSetting('rfid_serial_baud', baudRate);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/serial/select", requireAuth, (req, res) => {
  _closeSerial();
  deleteSetting('rfid_serial_path');
  deleteSetting('rfid_serial_baud');
  res.json({ ok: true });
});

// ── SSE event stream ──────────────────────────────────────────────────────
app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.flushHeaders();

  // Immediately push current reader status so the page knows the mode
  res.write(`data: ${JSON.stringify({ type: 'status', active: reader.isOpen || serialReader.isOpen })}\n\n`);

  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

// ── Reports ───────────────────────────────────────────────────────────────
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

export { app, db };
