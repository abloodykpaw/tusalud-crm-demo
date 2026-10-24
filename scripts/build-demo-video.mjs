/**
 * Genera demo con voz en español y exporta MP4 1080p para WhatsApp.
 * Uso: npm run dev + node scripts/build-demo-video.mjs
 */
import { chromium } from "playwright";
import ffmpegPath from "ffmpeg-static";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rename, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const WORK_DIR = path.join(ROOT, "preview", "demo-video");
const AUDIO_DIR = path.join(WORK_DIR, "audio");
const FINAL_MP4 = path.join(ROOT, "preview", "tusalud-crm-demo.mp4");
const RAW_WEBM = path.join(WORK_DIR, "raw.webm");
const NARRATION_MP3 = path.join(WORK_DIR, "narracion.mp3");
const BASE_URL = process.env.DEMO_URL || "http://localhost:5173";
const VIEWPORT = { width: 1920, height: 1080 };
const TTS_VOICE = "es-MX-DaliaNeural";
const TTS_RATE = "+2%";
const TTS_PITCH = "+0Hz";

const SEGMENTS = [
  {
    id: "01-login",
    text: "Te presento TuSalud Ensurance, el sistema del equipo de ventas. Cada persona entra con su rol: administrador, encargado, nómina o agente.",
  },
  {
    id: "02-admin",
    text: "Entramos como administrador. Desde aquí se ve y se controla todo el sistema.",
  },
  {
    id: "03-dashboard",
    text: "El dashboard es el resumen del día: leads activos, tareas pendientes y cómo va el equipo esta semana.",
  },
  {
    id: "04-reportes",
    text: "En reportes, cada agente sube sus listas de clientes, organizadas por campaña.",
  },
  {
    id: "05-reporte-detalle",
    text: "Aquí ves el detalle de cada carga: los nombres del día, el archivo adjunto y quién lo subió.",
  },
  {
    id: "06-leads",
    text: "Leads concentra todos los contactos. Puedes filtrar por agente, estado o semana.",
  },
  {
    id: "07-agentes",
    text: "Agentes muestra el rendimiento de cada vendedor: leads asignados, cierres y progreso semanal.",
  },
  {
    id: "08-agente-detalle",
    text: "Al abrir un perfil, ves toda la información de esa persona en un solo lugar.",
  },
  {
    id: "09-tareas",
    text: "Tareas sirve para asignar trabajo al equipo y ver qué está pendiente, en proceso o completado.",
  },
  {
    id: "10-pagos",
    text: "Pagos lleva las comisiones de la semana: monto, Zelle y si ya se pagó al agente.",
  },
  {
    id: "11-historial",
    text: "Historial guarda los movimientos importantes, por si hay que revisar algo después.",
  },
  {
    id: "12-usuarios",
    text: "Usuarios es donde se crean las cuentas y se define quién puede entrar y con qué rol.",
  },
  {
    id: "13-importar",
    text: "Importar sube muchos leads de una sola vez, desde Excel o CSV.",
  },
  {
    id: "14-encargado",
    text: "Como encargado, la vista se centra en supervisar al equipo y revisar los pagos.",
  },
  {
    id: "15-nomina",
    text: "Nómina trabaja solo con pagos e historial, pensado para el área administrativa.",
  },
  {
    id: "16-agente-rol",
    text: "El agente solo ve lo suyo: sus reportes, leads, tareas y pagos personales.",
  },
  {
    id: "17-cierre",
    text: "En resumen, ventas, equipo y operación en un solo lugar. Eso es TuSalud Ensurance.",
  },
];

function prepareSpeech(text) {
  return text.replace(/\s*\|\s*/g, " ").replace(/\s+/g, " ").trim();
}

async function ffprobeDuration(file) {
  const { stderr } = await execFileAsync(ffmpegPath, ["-i", file], {
    maxBuffer: 10 * 1024 * 1024,
  }).catch((err) => ({ stderr: err.stderr?.toString() || "" }));
  const match = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) throw new Error(`No se pudo leer duración de ${file}`);
  const [, h, m, s] = match;
  return (Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000;
}

async function ttsToMp3(text, outMp3) {
  const textFile = outMp3.replace(/\.mp3$/i, ".txt");
  await writeFile(textFile, prepareSpeech(text), "utf8");

  await execFileAsync("edge-tts", [
    "--voice",
    TTS_VOICE,
    "--rate",
    TTS_RATE,
    "--pitch",
    TTS_PITCH,
    "-f",
    textFile,
    "--write-media",
    outMp3,
  ]);

  await rm(textFile, { force: true });
}

const GAP_MS = 450;

async function makeGapMp3(gapFile) {
  await execFileAsync(ffmpegPath, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=24000:cl=mono",
    "-t",
    String(GAP_MS / 1000),
    "-c:a",
    "libmp3lame",
    "-q:a",
    "2",
    gapFile,
  ]);
}

async function generateNarration() {
  await rm(AUDIO_DIR, { recursive: true, force: true });
  await mkdir(AUDIO_DIR, { recursive: true });

  const gapFile = path.join(AUDIO_DIR, "_gap.mp3");
  await makeGapMp3(gapFile);
  const gapMs = await ffprobeDuration(gapFile);

  const durations = [];
  for (const seg of SEGMENTS) {
    const out = path.join(AUDIO_DIR, `${seg.id}.mp3`);
    process.stdout.write(`Voz: ${seg.id}\n`);
    await ttsToMp3(seg.text, out);
    const ms = await ffprobeDuration(out);
    durations.push({ ...seg, file: out, ms, gapMs: durations.length === 0 ? 0 : gapMs });
    console.log(`  ${(ms / 1000).toFixed(1)}s`);
  }

  const listFile = path.join(AUDIO_DIR, "concat.txt");
  const listLines = [];
  durations.forEach((d, index) => {
    if (index > 0) listLines.push(`file '${gapFile.replace(/\\/g, "/")}'`);
    listLines.push(`file '${d.file.replace(/\\/g, "/")}'`);
  });
  await writeFile(listFile, listLines.join("\n"), "utf8");

  await execFileAsync(ffmpegPath, [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-af",
    "aresample=44100,aformat=channel_layouts=mono",
    "-c:a",
    "libmp3lame",
    "-q:a",
    "2",
    NARRATION_MP3,
  ]);

  return durations;
}

async function ensureServer(url) {
  for (let i = 0; i < 30; i++) {
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

async function waitFor(page, ms) {
  await page.waitForTimeout(ms);
}

async function scrollPage(page, steps, stepMs = 650) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, 480);
    await waitFor(page, stepMs);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await waitFor(page, 700);
}

async function clickNav(page, label) {
  await page.locator(".sidebar .nav-item", { hasText: label }).first().click();
}

async function holdSegment(page, ms, scrollSteps = 0) {
  const start = Date.now();
  if (scrollSteps <= 0) {
    await waitFor(page, ms);
    return;
  }
  const scrollTime = scrollSteps * 1350 + 700;
  const remaining = Math.max(0, ms - scrollTime);
  const before = Math.max(400, remaining * 0.35);
  const after = Math.max(0, remaining - before);
  await waitFor(page, before);
  await scrollPage(page, scrollSteps);
  if (after > 0) await waitFor(page, after);
  const elapsed = Date.now() - start;
  if (elapsed < ms) await waitFor(page, ms - elapsed);
}

async function playSegment(page, audioMs, gapMs, prepare, scrollSteps = 0) {
  const start = Date.now();
  if (prepare) await prepare();
  const prepElapsed = Date.now() - start;
  if (gapMs > prepElapsed) await waitFor(page, gapMs - prepElapsed);

  const holdStart = Date.now();
  await holdSegment(page, audioMs, scrollSteps);
  const holdElapsed = Date.now() - holdStart;
  if (holdElapsed < audioMs) await waitFor(page, audioMs - holdElapsed);
}

async function recordWalkthrough(durations) {
  const byId = Object.fromEntries(durations.map((d) => [d.id, d]));
  const seg = (id) => byId[id];
  const gap = (id) => seg(id).gapMs || 0;

  await rm(path.join(WORK_DIR, "capture"), { recursive: true, force: true });
  await mkdir(path.join(WORK_DIR, "capture"), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: path.join(WORK_DIR, "capture"), size: VIEWPORT },
    locale: "es-VE",
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  try {
    console.log("Grabando video sincronizado...");
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await playSegment(page, seg("01-login").ms, gap("01-login"), null, 1);

    await playSegment(page, seg("02-admin").ms, gap("02-admin"), async () => {
      await page.locator(".demo-card", { hasText: /Administrador|Administrator/i }).first().click();
      await page.waitForSelector(".app.active", { timeout: 15000 });
    });

    await playSegment(page, seg("03-dashboard").ms, gap("03-dashboard"), null, 2);

    await playSegment(page, seg("04-reportes").ms, gap("04-reportes"), async () => {
      await clickNav(page, "Reportes");
    }, 2);

    const reportCard = page.locator(".report-agent-card").first();
    if (await reportCard.count()) {
      await playSegment(page, seg("05-reporte-detalle").ms, gap("05-reporte-detalle"), async () => {
        await reportCard.click();
      }, 2);
      await playSegment(page, seg("06-leads").ms, gap("06-leads"), async () => {
        await page.locator("button", { hasText: /Volver/i }).first().click();
        await clickNav(page, "Leads");
      }, 3);
    } else {
      await playSegment(page, seg("05-reporte-detalle").ms, gap("05-reporte-detalle"));
      await playSegment(page, seg("06-leads").ms, gap("06-leads"), async () => {
        await clickNav(page, "Leads");
      }, 3);
    }

    await playSegment(page, seg("07-agentes").ms, gap("07-agentes"), async () => {
      await clickNav(page, "Agentes");
    }, 2);

    const agentCard = page.locator(".agent-card").first();
    if (await agentCard.count()) {
      await playSegment(page, seg("08-agente-detalle").ms, gap("08-agente-detalle"), async () => {
        await agentCard.click();
      }, 2);
      await playSegment(page, seg("09-tareas").ms, gap("09-tareas"), async () => {
        await page.locator("button", { hasText: /Volver/i }).first().click();
        await clickNav(page, "Tareas");
      }, 3);
    } else {
      await playSegment(page, seg("08-agente-detalle").ms, gap("08-agente-detalle"));
      await playSegment(page, seg("09-tareas").ms, gap("09-tareas"), async () => {
        await clickNav(page, "Tareas");
      }, 3);
    }

    await playSegment(page, seg("10-pagos").ms, gap("10-pagos"), async () => {
      await clickNav(page, "Pagos");
    }, 3);

    await playSegment(page, seg("11-historial").ms, gap("11-historial"), async () => {
      await clickNav(page, "Historial");
    }, 2);

    await playSegment(page, seg("12-usuarios").ms, gap("12-usuarios"), async () => {
      await clickNav(page, "Usuarios");
    }, 2);

    await playSegment(page, seg("13-importar").ms, gap("13-importar"), async () => {
      await clickNav(page, "Importar");
    }, 2);

    await playSegment(page, seg("14-encargado").ms, gap("14-encargado"), async () => {
      await page.locator(".role-switcher-btn").click();
      await page.locator(".role-menu-item", { hasText: /Encargado/i }).click();
    }, 1);

    await playSegment(page, seg("15-nomina").ms, gap("15-nomina"), async () => {
      await page.locator(".role-switcher-btn").click();
      await page.locator(".role-menu-item", { hasText: /Nómina|Nomina/i }).click();
    }, 2);

    await playSegment(page, seg("16-agente-rol").ms, gap("16-agente-rol"), async () => {
      await page.locator(".role-switcher-btn").click();
      await page.locator(".role-menu-item", { hasText: /^Agente$/i }).click();
    }, 1);

    await playSegment(page, seg("17-cierre").ms, gap("17-cierre"), async () => {
      await clickNav(page, "Reportes");
      await page.locator(".preview-banner-bar button").click();
      await clickNav(page, "Dashboard");
    }, 1);
  } finally {
    const video = page.video();
    await context.close();
    await browser.close();
    if (video) {
      const tempPath = await video.path();
      await rename(tempPath, RAW_WEBM);
    }
  }
}

async function exportMp4() {
  console.log("Exportando MP4 1080p...");
  const videoMs = await ffprobeDuration(RAW_WEBM);
  const audioMs = await ffprobeDuration(NARRATION_MP3);
  const driftMs = audioMs - videoMs;
  console.log(`  Ajuste A/V: ${(driftMs / 1000).toFixed(2)}s`);

  const speedFactor = (videoMs / audioMs).toFixed(6);
  let videoFilter =
    "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black";
  if (Math.abs(driftMs) > 120) {
    videoFilter += `,setpts=PTS/${speedFactor}`;
  }
  videoFilter += "[v]";

  await execFileAsync(ffmpegPath, [
    "-y",
    "-i",
    RAW_WEBM,
    "-i",
    NARRATION_MP3,
    "-filter_complex",
    videoFilter,
    "-map",
    "[v]",
    "-map",
    "1:a:0",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "high",
    "-level",
    "4.1",
    "-r",
    "30",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "44100",
    "-movflags",
    "+faststart",
    "-shortest",
    FINAL_MP4,
  ]);
}

async function cleanup() {
  const captureDir = path.join(WORK_DIR, "capture");
  try {
    const files = await readdir(captureDir);
    for (const f of files) await rm(path.join(captureDir, f), { force: true });
    await rm(captureDir, { recursive: true, force: true });
  } catch {
    /* ok */
  }
}

async function main() {
  if (!ffmpegPath) throw new Error("ffmpeg-static no disponible");

  await mkdir(WORK_DIR, { recursive: true });
  console.log("Generando narración en español...");
  const durations = await generateNarration();

  console.log("Esperando servidor en", BASE_URL);
  await ensureServer(BASE_URL);
  await recordWalkthrough(durations);
  await exportMp4();
  await cleanup();

  const info = await execFileAsync(ffmpegPath, ["-i", FINAL_MP4], {
    maxBuffer: 10 * 1024 * 1024,
  }).catch((err) => ({ stderr: err.stderr?.toString() || "" }));
  const stderr = info.stderr || "";

  const durMatch = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const resMatch = stderr.match(/,\s(\d{3,4})x(\d{3,4})[\s,]/);
  const { size } = await import("node:fs/promises").then((fs) => fs.stat(FINAL_MP4));

  console.log("\nListo:");
  console.log("  Archivo:", FINAL_MP4);
  if (durMatch) console.log(`  Duración: ${durMatch[1]}:${durMatch[2]}:${durMatch[3]}`);
  if (resMatch) console.log(`  Resolución: ${resMatch[1]}x${resMatch[2]}`);
  console.log(`  Tamaño: ${(size / (1024 * 1024)).toFixed(1)} MB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
