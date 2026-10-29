import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";

// Execute the real orchestration with in-memory Vite and child-process mocks.
// No server, browser, environment file, or database is accessed by these tests.
const source = readFileSync(
  new URL("./browser/dev.mjs", import.meta.url),
  "utf8",
)
  .replace('import { spawn } from "node:child_process";', "")
  .replace('import { createServer, loadConfigFromFile } from "vite";', "");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const execute = new AsyncFunction(
  "spawn",
  "createServer",
  "loadConfigFromFile",
  "process",
  "console",
  source,
);

async function exercise(outcome) {
  let closed = 0;
  let listened = 0;
  const modes = [];
  const spawnFailure = new Error("mock spawn failure");
  const otherPlugin = { name: "retained-plugin" };
  const completion = execute(
    (_command, _args, options) => {
      modes.push(options.env.CSR_LIFECYCLE);
      const child = new EventEmitter();
      // Keep the unfixed harness's missing listener from crashing the test
      // process, so the deadline can report its unsettled promise and cleanup.
      child.on("error", () => {});
      queueMicrotask(() => {
        if (outcome === "error") child.emit("error", spawnFailure);
        else child.emit("exit", outcome === "nonzero" ? 7 : 0);
      });
      return child;
    },
    async (config) => {
      assert.deepEqual(config.plugins, [otherPlugin]);
      return {
        async listen() {
          listened++;
        },
        async close() {
          closed++;
        },
      };
    },
    async () => ({
      config: { plugins: [{ name: "void:migrations" }, otherPlugin] },
    }),
    { execPath: "mock-node", env: {} },
    { log() {} },
  );
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("Harness did not settle after child event")),
      1000,
    );
  });
  try {
    if (outcome === "error") {
      await assert.rejects(
        Promise.race([completion, deadline]),
        (error) => error === spawnFailure,
      );
    } else if (outcome === "nonzero") {
      await assert.rejects(
        Promise.race([completion, deadline]),
        /lifecycle=false exited 7/,
      );
    } else {
      await Promise.race([completion, deadline]);
    }
    assert.equal(listened, 1);
    assert.equal(closed, 1, "Server cleanup must run exactly once");
    assert.deepEqual(modes, outcome === "success" ? ["0", "1"] : ["0"]);
  } finally {
    clearTimeout(timer);
  }
}

test("dev browser harness closes its server after child spawn error", () =>
  exercise("error"));
test("dev browser harness closes its server after nonzero child exit", () =>
  exercise("nonzero"));
test("dev browser harness runs both suites and closes its server on success", () =>
  exercise("success"));
