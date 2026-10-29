import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("browser runner generates a parsable payload from the formatted CSR script", () => {
  const directory = mkdtempSync(
    join(
      existsSync("/private/tmp/opencode") ? "/private/tmp/opencode" : tmpdir(),
      "csr-runner-test-",
    ),
  );
  const cli = join(directory, "fake-playwright-cli.mjs");
  const calls = join(directory, "calls.jsonl");
  try {
    writeFileSync(
      cli,
      `#!${process.execPath}
import { appendFileSync } from "node:fs";
import { Script } from "node:vm";
const command = process.argv[4];
appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ command, cwd: process.cwd() }) + "\\n");
if (command === "run-code") new Script(process.argv[5]);
`,
      { mode: 0o755 },
    );
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./browser/run.mjs", import.meta.url))],
      {
        env: {
          ...process.env,
          CSR_BUILT_WORKER: "0",
          CSR_BASE_URL: "http://localhost:5173",
          PLAYWRIGHT_CLI: cli,
        },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const recorded = readFileSync(calls, "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.deepEqual(
      recorded.map(({ command }) => command),
      ["open", "run-code", "close"],
    );
  } finally {
    if (existsSync(calls)) {
      const { cwd } = JSON.parse(readFileSync(calls, "utf8").split("\n")[0]);
      rmSync(cwd, { recursive: true, force: true });
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
