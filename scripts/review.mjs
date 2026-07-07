import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { spawn } from "node:child_process";

const reviewDir = join(process.cwd(), "review");
const reportPath = join(reviewDir, "ReviewReport.md");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const checks = [
  {
    key: "build",
    label: "Build",
    command: ["run", "build"],
  },
  {
    key: "playwright",
    label: "Playwright",
    command: ["run", "test:e2e"],
  },
  {
    key: "screenshots",
    label: "Screenshots",
    command: ["run", "review:screenshots"],
  },
  {
    key: "lighthouse",
    label: "Lighthouse",
    command: ["run", "review:lighthouse"],
  },
];

function formatDuration(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusText(result) {
  return result.exitCode === 0 ? "Passed" : `Failed (exit ${result.exitCode})`;
}

function runCheck(check) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let output = "";

    console.log(`\n=== ${check.label}: npm ${check.command.join(" ")} ===`);

    const child = spawn(npmCommand, check.command, {
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    child.stdout.on("data", (data) => {
      const text = data.toString();
      output += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      output += text;
      process.stderr.write(text);
    });

    child.on("error", (error) => {
      const text = `${error.stack ?? error.message}\n`;
      output += text;
      process.stderr.write(text);
      resolve({
        ...check,
        exitCode: 1,
        durationMs: Date.now() - startedAt,
        output,
      });
    });

    child.on("close", (exitCode) => {
      resolve({
        ...check,
        exitCode: exitCode ?? 1,
        durationMs: Date.now() - startedAt,
        output,
      });
    });
  });
}

async function listGeneratedFiles() {
  const roots = [
    join(reviewDir, "screenshots"),
    join(reviewDir, "lighthouse"),
  ];
  const files = [];

  for (const root of roots) {
    try {
      const entries = await readdir(root);
      for (const entry of entries) {
        const fullPath = join(root, entry);
        const info = await stat(fullPath);
        if (info.isFile()) {
          files.push({
            path: relative(process.cwd(), fullPath).replaceAll("\\", "/"),
            bytes: info.size,
          });
        }
      }
    } catch {
      // Missing review outputs are represented by the status rows.
    }
  }

  files.push({
    path: relative(process.cwd(), reportPath).replaceAll("\\", "/"),
    bytes: 0,
  });

  return files;
}

function collectKnownWarnings(results) {
  const combined = results.map((result) => result.output).join("\n");
  const warnings = [];

  if (combined.includes("vite-tsconfig-paths")) {
    warnings.push("Vite reports that `vite-tsconfig-paths` can be replaced by native `resolve.tsconfigPaths` support.");
  }
  if (combined.includes("[PLUGIN_TIMINGS]")) {
    warnings.push("Vite reports plugin timing diagnostics during build.");
  }
  if (combined.includes("inlineDynamicImports")) {
    warnings.push("Vite/Nitro warns that `inlineDynamicImports` is ignored when `codeSplitting` is specified.");
  }
  if (combined.includes("hydrated but some attributes of the server rendered HTML didn't match")) {
    warnings.push("React logs an existing hydration attribute mismatch during browser-based review commands.");
  }
  if (combined.match(/\d+\s+moderate severity vulnerabilities/i)) {
    warnings.push("npm audit reports moderate severity vulnerabilities in installed dependencies.");
  }

  return warnings.length ? warnings : ["No known warnings captured."];
}

async function readLighthouseScores() {
  try {
    const raw = await import("node:fs/promises").then(({ readFile }) =>
      readFile(join(reviewDir, "lighthouse", "dashboard.json"), "utf8"),
    );
    const data = JSON.parse(raw);
    return Object.entries(data.categories ?? {})
      .map(([key, value]) => `${key}: ${Math.round((value.score ?? 0) * 100)}`)
      .join(", ");
  } catch {
    return null;
  }
}

async function writeReport(results) {
  await mkdir(reviewDir, { recursive: true });
  const generatedFiles = await listGeneratedFiles();
  const warnings = collectKnownWarnings(results);
  const lighthouseScores = await readLighthouseScores();
  const safe = results.every((result) => result.exitCode === 0);

  const lines = [
    "# BatchMatch Review Report",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "## Status",
    "",
    `- Build status: ${statusText(results.find((result) => result.key === "build"))}`,
    `- Playwright status: ${statusText(results.find((result) => result.key === "playwright"))}`,
    `- Screenshot status: ${statusText(results.find((result) => result.key === "screenshots"))}`,
    `- Lighthouse status: ${statusText(results.find((result) => result.key === "lighthouse"))}`,
    lighthouseScores ? `- Lighthouse scores: ${lighthouseScores}` : "- Lighthouse scores: unavailable",
    "",
    "## Command Durations",
    "",
    ...results.map((result) => `- ${result.label}: ${formatDuration(result.durationMs)}`),
    "",
    "## Generated Files",
    "",
    ...generatedFiles.map((file) => `- ${file.path}${file.bytes ? ` (${file.bytes} bytes)` : ""}`),
    "",
    "## Known Warnings",
    "",
    ...warnings.map((warning) => `- ${warning}`),
    "",
    "## Safe To Commit",
    "",
    safe
      ? "Safe to commit: yes. All review commands passed."
      : "Safe to commit: no. One or more review commands failed.",
    "",
  ];

  await writeFile(reportPath, lines.join("\n"), "utf8");
  return { reportPath, safe };
}

const results = [];
for (const check of checks) {
  results.push(await runCheck(check));
}

const { reportPath: writtenReportPath, safe } = await writeReport(results);
console.log(`\nReview report written to ${writtenReportPath}`);

if (!safe) process.exitCode = 1;
