import { test, expect } from "@playwright/test";

const BASE = "http://localhost:3001";

async function emulateRFID(page, cardId) {
  await page.evaluate(() => $("scanCard").focus());
  for (const ch of cardId) {
    await page.keyboard.press(ch === " " ? "Space" : ch);
  }
  await page.keyboard.press("Enter");
}

let cardSeq = 0;
function uid() { return `KS${++cardSeq}${Date.now().toString(36)}`; }

test.describe("Kiosk RFID scan page", () => {
  test("loads and shows ready indicator", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".scan-hero")).toBeVisible();
    await expect(page.locator("#scanCard")).toBeVisible();
  });

  test("shows greeting card on successful scan", async ({ page }) => {
    const card = uid();
    const req = page.request;
    await req.post(`${BASE}/api/login`, { data: { username: "admin", password: "admin123" } });
    await req.post(`${BASE}/api/employees`, { data: { card_id: card, name: "Kiosk Tester", title: "QA" } });

    await page.goto("/");
    await emulateRFID(page, card);

    const greeting = page.locator(".greeting-card");
    await expect(greeting).toBeVisible({ timeout: 5000 });
    await expect(greeting).toContainText("Kiosk Tester");
    await expect(greeting).toContainText("تسجيل دخول");
  });

  test("dedup returns same type within 10s cooldown", async ({ page }) => {
    const card = uid();
    const req = page.request;
    await req.post(`${BASE}/api/login`, { data: { username: "admin", password: "admin123" } });
    await req.post(`${BASE}/api/employees`, { data: { card_id: card, name: "Dedup Tester", title: "QA" } });

    await page.goto("/");
    await emulateRFID(page, card);
    await expect(page.locator(".greeting-card")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".greeting-card")).toContainText("تسجيل دخول");

    await page.waitForTimeout(500);

    await emulateRFID(page, card);
    await expect(page.locator(".greeting-card")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".greeting-card")).toContainText("تسجيل دخول");
  });

  test("shows error for unknown card", async ({ page }) => {
    await page.goto("/");
    await emulateRFID(page, "NOEXIST");

    const msg = page.locator(".msg-err");
    await expect(msg).toBeVisible({ timeout: 5000 });
    await expect(msg).toContainText("بطاقة غير معرفة");
  });

  test("clears message after 5 seconds", async ({ page }) => {
    const card = uid();
    const req = page.request;
    await req.post(`${BASE}/api/login`, { data: { username: "admin", password: "admin123" } });
    await req.post(`${BASE}/api/employees`, { data: { card_id: card, name: "Clear Tester", title: "QA" } });

    await page.goto("/");
    await emulateRFID(page, card);
    await expect(page.locator(".greeting-card")).toBeVisible({ timeout: 5000 });

    await page.waitForTimeout(5500);
    await expect(page.locator("#scanMsg")).toBeEmpty();
  });

  test("dedup confirmed via sequential scans", async ({ page }) => {
    const card = uid();
    const req = page.request;
    await req.post(`${BASE}/api/login`, { data: { username: "admin", password: "admin123" } });
    await req.post(`${BASE}/api/employees`, { data: { card_id: card, name: "Seq Tester", title: "QA" } });

    await page.goto("/");
    await emulateRFID(page, card);
    await expect(page.locator(".greeting-card")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".greeting-card")).toContainText("تسجيل دخول");

    await page.waitForTimeout(500);
    await emulateRFID(page, card);
    await expect(page.locator(".greeting-card")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".greeting-card")).toContainText("تسجيل دخول");
  });
});
