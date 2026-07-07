import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import lighthouse from "lighthouse";
import { launch } from "chrome-launcher";
import { chromium } from "playwright";
import { ReportGenerator } from "lighthouse/report/generator/report-generator.js";

const baseUrl = "http://127.0.0.1:5173";
const outputDir = join(process.cwd(), "review", "lighthouse");
const session = {
  id: "u_demo",
  username: "demo",
  fullName: "Andi Setiawan",
  email: "andi@demo.id",
};
const preferences = {
  theme: "light",
  language: "en",
};
const execFileAsync = promisify(execFile);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    delay(timeoutMs).then(() => {
      throw new Error(`Timed out after ${timeoutMs}ms`);
    }),
  ]);
}

async function canReach(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer(url, timeoutMs = 120_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await canReach(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function startServer() {
  if (await canReach(baseUrl)) return null;

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const server = spawn(
    npmCommand,
    ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5173"],
    {
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  server.stdout.on("data", (data) => process.stdout.write(`[dev] ${data}`));
  server.stderr.on("data", (data) => process.stderr.write(`[dev] ${data}`));

  await waitForServer(baseUrl);
  return server;
}

async function stopServer(server) {
  if (!server) return;
  if (server.exitCode !== null || server.signalCode) return;

  if (process.platform === "win32") {
    await execFileAsync("taskkill", ["/pid", String(server.pid), "/T", "/F"]).catch(() => {});
    return;
  }

  server.kill("SIGTERM");
}

async function seedBrowserStorage(port) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ sessionValue, preferenceValue }) => {
      window.localStorage.setItem("batchmatch:session", JSON.stringify(sessionValue));
      window.localStorage.setItem("batchmatch:preferences", JSON.stringify(preferenceValue));
    },
    { sessionValue: session, preferenceValue: preferences },
  );
  await page.close();

  return browser;
}

async function runAudit() {
  const server = await startServer();
  let chrome;
  let cdpBrowser;

  try {
    await mkdir(outputDir, { recursive: true });

    chrome = await launch({
      chromePath: chromium.executablePath(),
      chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
    });
    cdpBrowser = await seedBrowserStorage(chrome.port);

    const result = await lighthouse(baseUrl, {
      port: chrome.port,
      output: ["html", "json"],
      logLevel: "info",
      onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      disableStorageReset: true,
      formFactor: "desktop",
      screenEmulation: {
        mobile: false,
        width: 1440,
        height: 1000,
        deviceScaleFactor: 1,
        disabled: false,
      },
      throttlingMethod: "provided",
    });

    if (!result?.lhr) throw new Error("Lighthouse did not return a report.");

    const html = ReportGenerator.generateReportHtml(result.lhr);
    await writeFile(join(outputDir, "dashboard.html"), html, "utf8");
    await writeFile(join(outputDir, "dashboard.json"), JSON.stringify(result.lhr, null, 2), "utf8");

    const categories = Object.entries(result.lhr.categories)
      .map(([key, value]) => `${key}: ${Math.round((value.score ?? 0) * 100)}`)
      .join(", ");
    console.log(`Lighthouse report written to ${outputDir}`);
    console.log(`Scores: ${categories}`);
  } finally {
    if (cdpBrowser) await withTimeout(cdpBrowser.close(), 3000).catch(() => {});
    if (chrome) await Promise.resolve(chrome.kill()).catch(() => {});
    await stopServer(server);
  }
}

runAudit().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
