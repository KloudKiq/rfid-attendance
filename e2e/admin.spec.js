import { test, expect } from "@playwright/test";

const BASE = "http://localhost:3001";

async function adminLogin(page) {
  await page.goto("/admin.html");
  const loginVisible = await page.locator("#user").isVisible().catch(() => false);
  if (loginVisible) {
    await page.fill("#user", "admin");
    await page.fill("#pass", "admin123");
    await page.click("button:has-text('دخول')");
  }
  await expect(page.locator("#adminApp")).toBeVisible({ timeout: 5000 });
}

let cardSeq = 0;
function uid() { return `AD${++cardSeq}${Date.now().toString(36)}`; }

test.describe("Admin panel", () => {
  test("shows login screen when not authenticated", async ({ page }) => {
    await page.goto("/admin.html");
    await expect(page.locator("#loginScreen")).toBeVisible();
    await expect(page.locator("#adminApp")).toBeHidden();
  });

  test("logs in with correct credentials", async ({ page }) => {
    await page.goto("/admin.html");
    await page.fill("#user", "admin");
    await page.fill("#pass", "admin123");
    await page.click("button:has-text('دخول')");

    await expect(page.locator("#adminApp")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#adminName")).toContainText("admin");
  });

  test("shows error on wrong password", async ({ page }) => {
    await page.goto("/admin.html");
    await page.fill("#user", "admin");
    await page.fill("#pass", "wrongpass");
    await page.click("button:has-text('دخول')");

    await expect(page.locator("#loginErr")).toContainText("بيانات الدخول غير صحيحة", { timeout: 5000 });
  });

  test("can register employee", async ({ page }) => {
    const card = uid();
    await adminLogin(page);

    await page.fill("#newCard", card);
    await page.fill("#newName", "Admin Employee");
    await page.fill("#newTitle", "Manager");
    await page.click("button:has-text('إضافة')");

    await expect(page.locator("#addMsg")).toContainText("تمت إضافة الموظف", { timeout: 5000 });
    await expect(page.locator("#employees")).toContainText("Admin Employee");
    await expect(page.locator("#employees")).toContainText(card);
  });

  test("shows today tab with records", async ({ page }) => {
    const card = uid();
    const req = page.request;
    await req.post(`${BASE}/api/login`, { data: { username: "admin", password: "admin123" } });
    await req.post(`${BASE}/api/employees`, { data: { card_id: card, name: "Today E2E", title: "Staff" } });
    await req.post(`${BASE}/api/check`, { data: { card_id: card } });

    await adminLogin(page);

    await page.locator(".tab", { hasText: "حركات اليوم" }).click();
    await expect(page.locator("#today")).toContainText("Today E2E", { timeout: 5000 });
    await expect(page.locator("#today")).toContainText("دخول");
  });

  test("can load and view reports", async ({ page }) => {
    const card = uid();
    const req = page.request;
    await req.post(`${BASE}/api/login`, { data: { username: "admin", password: "admin123" } });
    await req.post(`${BASE}/api/employees`, { data: { card_id: card, name: "Report E2E", title: "Staff" } });
    await req.post(`${BASE}/api/check`, { data: { card_id: card } });

    await adminLogin(page);

    await page.locator(".tab", { hasText: "التقارير" }).click();
    await page.waitForTimeout(500);

    const today = new Date().toISOString().slice(0, 10);
    await page.fill("#rFrom", today);
    await page.fill("#rTo", today);
    await page.click("button:has-text('عرض التقرير')");

    await expect(page.locator("#reportOut")).toContainText("Report E2E", { timeout: 5000 });
    await expect(page.locator("#reportOut")).toContainText(card);
  });

  test("report presets set correct dates", async ({ page }) => {
    await adminLogin(page);

    await page.locator(".tab", { hasText: "التقارير" }).click();
    await page.waitForTimeout(500);

    await page.click("button.preset-btn:has-text('اليوم')");
    const from = await page.inputValue("#rFrom");
    const to = await page.inputValue("#rTo");
    const today = new Date().toISOString().slice(0, 10);
    expect(from).toBe(today);
    expect(to).toBe(today);
  });

  test("can logout", async ({ page }) => {
    await adminLogin(page);

    await page.click("button:has-text('خروج')");

    await expect(page.locator("#loginScreen")).toBeVisible({ timeout: 5000 });
  });

  test("switches between tabs", async ({ page }) => {
    await adminLogin(page);

    await page.locator(".tab", { hasText: "حركات اليوم" }).click();
    await expect(page.locator("#tab-today")).toHaveClass(/active/);

    await page.locator(".tab", { hasText: "التقارير" }).click();
    await expect(page.locator("#tab-reports")).toHaveClass(/active/);

    await page.locator(".tab", { hasText: "الموظفون" }).click();
    await expect(page.locator("#tab-employees")).toHaveClass(/active/);
  });
});
