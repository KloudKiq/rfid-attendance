import { test, expect } from "@playwright/test";

const BASE = "http://localhost:3001";

async function emulateRFID(page, cardId) {
  await page.evaluate(() => $("scanCard").focus());
  for (const ch of cardId) {
    await page.keyboard.press(ch === " " ? "Space" : ch);
  }
  await page.keyboard.press("Enter");
}

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
function uid() { return `WF${++cardSeq}${Date.now().toString(36)}`; }

test.describe("Full workflow: register → scan → report", () => {
  test("complete attendance cycle", async ({ page }) => {
    const CARD = uid();
    const NAME = "Flow Employee";

    // Step 1: Admin registers employee
    await adminLogin(page);

    await page.fill("#newCard", CARD);
    await page.fill("#newName", NAME);
    await page.fill("#newTitle", "Engineer");
    await page.click("button:has-text('إضافة')");
    await expect(page.locator("#addMsg")).toContainText("تمت إضافة الموظف", { timeout: 5000 });

    // Step 2: Kiosk — scan IN
    await page.goto("/");
    await emulateRFID(page, CARD);
    const greetingIn = page.locator(".greeting-card");
    await expect(greetingIn).toBeVisible({ timeout: 5000 });
    await expect(greetingIn).toContainText(NAME);
    await expect(greetingIn).toContainText("تسجيل دخول");

    // Step 3: Kiosk — second scan (dedup within cooldown)
    await page.waitForTimeout(500);
    await emulateRFID(page, CARD);
    const greeting2 = page.locator(".greeting-card");
    await expect(greeting2).toBeVisible({ timeout: 5000 });
    await expect(greeting2).toContainText("تسجيل دخول");

    // Step 4: Admin — verify today shows the record
    await adminLogin(page);

    await page.locator(".tab", { hasText: "حركات اليوم" }).click();
    await expect(page.locator("#today")).toContainText(NAME, { timeout: 5000 });

    // Step 5: Admin — verify report shows the employee
    await page.locator(".tab", { hasText: "التقارير" }).click();
    await page.waitForTimeout(500);
    const todayStr = new Date().toISOString().slice(0, 10);
    await page.fill("#rFrom", todayStr);
    await page.fill("#rTo", todayStr);
    await page.click("button:has-text('عرض التقرير')");

    await expect(page.locator("#reportOut")).toContainText(NAME, { timeout: 5000 });
    await expect(page.locator("#reportOut")).toContainText(CARD);
    await expect(page.locator("#reportOut")).toContainText("يوم");
  });

  test("multiple employees scan in sequence", async ({ page }) => {
    const employees = [
      { card: uid(), name: "Employee One", title: "Dev" },
      { card: uid(), name: "Employee Two", title: "QA" },
      { card: uid(), name: "Employee Three", title: "PM" },
    ];

    const req = page.request;
    await req.post(`${BASE}/api/login`, { data: { username: "admin", password: "admin123" } });
    for (const emp of employees) {
      await req.post(`${BASE}/api/employees`, { data: { card_id: emp.card, name: emp.name, title: emp.title } });
    }

    await page.goto("/");
    for (const emp of employees) {
      await emulateRFID(page, emp.card);
      const greeting = page.locator(".greeting-card");
      await expect(greeting).toBeVisible({ timeout: 5000 });
      await expect(greeting).toContainText(emp.name);
      await expect(greeting).toContainText("تسجيل دخول");
      await page.waitForTimeout(500);
    }

    // Verify all appear in admin today
    await adminLogin(page);

    await page.locator(".tab", { hasText: "حركات اليوم" }).click();
    for (const emp of employees) {
      await expect(page.locator("#today")).toContainText(emp.name, { timeout: 5000 });
    }
  });

  test("employee filter in report", async ({ page }) => {
    const card1 = uid();
    const card2 = uid();
    const req = page.request;
    await req.post(`${BASE}/api/login`, { data: { username: "admin", password: "admin123" } });
    await req.post(`${BASE}/api/employees`, { data: { card_id: card1, name: "Filter Me", title: "Staff" } });
    await req.post(`${BASE}/api/employees`, { data: { card_id: card2, name: "Filter Other", title: "Staff" } });
    await req.post(`${BASE}/api/check`, { data: { card_id: card1 } });

    await adminLogin(page);

    await page.locator(".tab", { hasText: "التقارير" }).click();
    await page.waitForTimeout(500);
    const today = new Date().toISOString().slice(0, 10);
    await page.fill("#rFrom", today);
    await page.fill("#rTo", today);

    // Search and select specific employee
    await page.fill("#rEmpSearch", "Filter Me");
    await page.waitForTimeout(300);
    await page.click(".emp-option:has-text('Filter Me')");
    await page.click("button:has-text('عرض التقرير')");

    await expect(page.locator("#reportOut")).toContainText("Filter Me", { timeout: 5000 });
    const reportText = await page.locator("#reportOut").textContent();
    expect(reportText).not.toContain("Filter Other");
  });

  test("CSV export generates download", async ({ page }) => {
    const card = uid();
    const req = page.request;
    await req.post(`${BASE}/api/login`, { data: { username: "admin", password: "admin123" } });
    await req.post(`${BASE}/api/employees`, { data: { card_id: card, name: "CSV Employee", title: "Staff" } });
    await req.post(`${BASE}/api/check`, { data: { card_id: card } });

    await adminLogin(page);

    await page.locator(".tab", { hasText: "التقارير" }).click();
    await page.waitForTimeout(500);
    const today = new Date().toISOString().slice(0, 10);
    await page.fill("#rFrom", today);
    await page.fill("#rTo", today);
    await page.click("button:has-text('عرض التقرير')");
    await expect(page.locator("#reportOut")).toContainText("CSV Employee", { timeout: 5000 });
    await expect(page.locator("#reportOut")).toContainText(card);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.click("button:has-text('تصدير CSV')"),
    ]);
    expect(download.suggestedFilename()).toMatch(/report-.*\.csv/);
  });
});
