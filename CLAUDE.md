# CLAUDE.md — rfid-attendance-kiss

## API Spec

OpenAPI 3.0 spec lives at `openapi.yaml`. **Keep it in sync with `server.js`.**

### When to update openapi.yaml

Update it whenever you add, remove, or change any of the following in `server.js`:
- A route (`app.get/post/...`)
- A request body field
- A response field or status code
- Auth requirement on a route
- The cooldown constant `CARD_COOLDOWN_SECONDS`

### After editing openapi.yaml, validate

```bash
npx @redocly/cli lint openapi.yaml
```

Must exit with `Your API description is valid` before committing. Warnings are OK; errors are not.

### Current routes (as of 2026-07-04)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/login | public | Admin login |
| POST | /api/logout | public | Destroy session |
| GET | /api/me | public | Session check |
| GET | /api/employees | 🔒 | List employees |
| POST | /api/employees | 🔒 | Register employee |
| POST | /api/check | public | Scan card (check-in/out) |
| GET | /api/today | 🔒 | Today's attendance |
| GET | /api/reports | 🔒 | Attendance report (date range) |
| GET | /api/reports/monthly | 🔒 | (Legacy) redirects to /api/reports |
| GET | /api/devices | 🔒 | List USB HID devices |
| GET | /api/devices/status | public | HID reader status |
| POST | /api/devices/select | 🔒 | Open HID device as reader |
| DELETE | /api/devices/select | 🔒 | Stop HID reader |
| GET | /api/serial/ports | 🔒 | List serial (USB-CDC) ports |
| GET | /api/serial/status | public | Serial reader status |
| POST | /api/serial/select | 🔒 | Open serial port as reader |
| DELETE | /api/serial/select | 🔒 | Stop serial reader |
| GET | /api/events | public | SSE scan/status stream |

## Key constants

| Constant | File | Value | Notes |
|----------|------|-------|-------|
| `CARD_COOLDOWN_SECONDS` | server.js | 10 | Per-card dedup window |
| `SCAN_TIMEOUT_MS` | public/index.html | 300 | HID buffer flush delay |

## Stack

- Backend: Node.js + Express + better-sqlite3
- Frontend: Vanilla JS, no framework
- DB: SQLite (`attendance.db`) — `CURRENT_TIMESTAMP` stores UTC
- Session: express-session (cookie: `connect.sid`)
