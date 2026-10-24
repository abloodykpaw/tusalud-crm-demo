/**
 * Graba un recorrido completo del CRM sin modificar la app.
 * Uso: npm run dev (en otra terminal) + node scripts/record-site-demo.mjs
 */
import { chromium } from "playwright";
import { mkdir, rename, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "preview", "demo-video");
const FINAL_VIDEO = path.join(ROOT, "preview", "tusalud-crm-demo.webm");
const BASE_URL = process.env.DEMO_URL || "http://localhost:5173";

const VIEWPORT = { width: 1440, height: 900 };

async function pause(page, ms = 2200) {
  await page.waitForTimeout(ms);
}

async function scrollPage(page, steps = 3) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, 420);
    await pause(page, 700);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await pause(page, 900);
}

async function clickNav(page, label) {
  const sidebar = page.locator(".sidebar .nav-item", { hasText: label });
  await sidebar.first().click();
  await pause(page, 1800);
}

async function ensureServer(url) {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Servidor no disponible en ${url}. Ejecuta: npm run dev`);
}

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  console.log("Esperando servidor en", BASE_URL);
  await ensureServer(BASE_URL);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: {
      dir: OUT_DIR,
      size: VIEWPORT,
    },
    locale: "es-VE",
  });

  const page = await context.newPage();

  try {
    console.log("Grabando: pantalla de login");
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await pause(page, 3500);

    console.log("Grabando: acceso como admin");
    await page.locator(".demo-card", { hasText: /Administrador|Administrator/i }).first().click();
    await page.waitForSelector(".app.active", { timeout: 15000 });
    await pause(page, 2500);

    console.log("Grabando: Dashboard");
    await scrollPage(page, 2);

    console.log("Grabando: Reportes");
    await clickNav(page, "Reportes");
    await scrollPage(page, 2);
    const reportCard = page.locator(".report-agent-card").first();
    if (await reportCard.count()) {
      await reportCard.click();
      await pause(page, 2800);
      await scrollPage(page, 2);
      await page.locator("button", { hasText: /Volver|Back/i }).first().click();
      await pause(page, 1500);
    }

    console.log("Grabando: Leads");
    await clickNav(page, "Leads");
    await scrollPage(page, 3);

    console.log("Grabando: Agentes");
    await clickNav(page, "Agentes");
    await scrollPage(page, 2);
    const agentCard = page.locator(".agent-card").first();
    if (await agentCard.count()) {
      await agentCard.click();
      await pause(page, 2800);
      await scrollPage(page, 2);
      await page.locator("button", { hasText: /Volver|Back/i }).first().click();
      await pause(page, 1500);
    }

    console.log("Grabando: Tareas");
    await clickNav(page, "Tareas");
    await scrollPage(page, 3);

    console.log("Grabando: Pagos");
    await clickNav(page, "Pagos");
    await scrollPage(page, 3);

    console.log("Grabando: Historial");
    await clickNav(page, "Historial");
    await scrollPage(page, 2);

    console.log("Grabando: Usuarios");
    await clickNav(page, "Usuarios");
    await scrollPage(page, 2);

    console.log("Grabando: Importar");
    await clickNav(page, "Importar");
    await scrollPage(page, 2);

    console.log("Grabando: vista Encargado");
    await page.locator(".role-switcher-btn").click();
    await pause(page, 800);
    await page.locator(".role-menu-item", { hasText: /Encargado/i }).click();
    await pause(page, 2200);
    await scrollPage(page, 1);
    await clickNav(page, "Pagos");
    await scrollPage(page, 1);

    console.log("Grabando: vista Nómina");
    await page.locator(".role-switcher-btn").click();
    await pause(page, 800);
    await page.locator(".role-menu-item", { hasText: /Nómina|Nomina/i }).click();
    await pause(page, 2200);
    await scrollPage(page, 2);

    console.log("Grabando: vista Agente");
    await page.locator(".role-switcher-btn").click();
    await pause(page, 800);
    await page.locator(".role-menu-item", { hasText: /Agente/i }).click();
    await pause(page, 2200);
    await scrollPage(page, 1);
    await clickNav(page, "Reportes");
    await scrollPage(page, 1);

    console.log("Grabando: cierre en Dashboard admin");
    await page.locator(".preview-banner-bar button").click();
    await pause(page, 1200);
    await clickNav(page, "Dashboard");
    await pause(page, 3000);
  } finally {
    const video = page.video();
    await context.close();
    await browser.close();

    if (video) {
      const tempPath = await video.path();
      await rename(tempPath, FINAL_VIDEO);
      const files = await readdir(OUT_DIR);
      for (const f of files) {
        await rm(path.join(OUT_DIR, f), { force: true });
      }
      await rm(OUT_DIR, { recursive: true, force: true });
      console.log("\nVideo guardado en:", FINAL_VIDEO);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
