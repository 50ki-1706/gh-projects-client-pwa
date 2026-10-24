import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const built = process.env.CSR_BUILT_WORKER === "1";
const origin = new URL(process.env.CSR_BASE_URL ?? `http://localhost:${built ? 5174 : 5173}`).origin;
if (!/^http:\/\/localhost:\d+$/.test(origin)) throw new Error("Use an isolated localhost HTTP server");
const session = `csr-migration-${built ? "built" : "dev"}-${process.pid}`;
const cli = process.env.PLAYWRIGHT_CLI ?? "playwright-cli";
const cwd = mkdtempSync(join(existsSync("/private/tmp/opencode") ? "/private/tmp/opencode" : tmpdir(), "csr-browser-"));
const script = readFileSync(new URL("./csr.cjs", import.meta.url), "utf8");

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, [`-s=${session}`, "--raw", ...args], { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`playwright-cli ${args[0]} exited ${code}`)));
  });
}

let worker;
try {
  if (built) {
    const require = createRequire(import.meta.url);
    const { unstable_dev } = require(require.resolve("wrangler", { paths: [require.resolve("void")] }));
    worker = await unstable_dev(fileURLToPath(new URL("../../dist/ssr/index.js", import.meta.url)), {
      config: fileURLToPath(new URL("../../dist/ssr/wrangler.json", import.meta.url)),
      vars: { BETTER_AUTH_SECRET: randomBytes(48).toString("base64url") },
      port: Number(new URL(origin).port), ip: "localhost",
      local: true, persist: false, bundle: false, logLevel: "none",
      experimental: { watch: false, disableDevRegistry: true, disableExperimentalWarning: true },
    });
  }
  await run(["open", "--browser=chrome"]);
  await run(["run-code", `async page => (${script})(page, ${JSON.stringify(origin)})`]);
} finally {
  try { await run(["close"]); }
  finally { if (worker) await worker.stop(); }
}
