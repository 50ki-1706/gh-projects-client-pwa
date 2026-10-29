// Foreground orchestration with the real Vite config, minus DB startup writes.
import { spawn } from "node:child_process";
import { createServer, loadConfigFromFile } from "vite";

const loaded = await loadConfigFromFile({
  command: "serve",
  mode: "development",
});
if (!loaded) throw new Error("Vite config not found");
async function flatten(options) {
  return (
    await Promise.all(
      options.map(async (option) => {
        const resolved = await option;
        return Array.isArray(resolved) ? flatten(resolved) : resolved;
      }),
    )
  )
    .flat()
    .filter(Boolean);
}
const plugins = await flatten(loaded.config.plugins ?? []);
if (plugins.filter((plugin) => plugin.name === "void:migrations").length !== 1)
  throw new Error(
    "Expected exactly one Void startup migration plugin; review test isolation",
  );
const server = await createServer({
  ...loaded.config,
  configFile: false,
  plugins: plugins.filter((plugin) => plugin.name !== "void:migrations"),
  server: { host: "localhost", port: 5173, strictPort: true },
});

async function run(lifecycle) {
  const child = spawn(process.execPath, ["tests/browser/run.mjs"], {
    stdio: "inherit",
    env: {
      ...process.env,
      CSR_BASE_URL: "http://localhost:5173",
      CSR_BUILT_WORKER: "0",
      CSR_LIFECYCLE: lifecycle ? "1" : "0",
    },
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0)
    throw new Error(`Browser suite lifecycle=${lifecycle} exited ${code}`);
}

try {
  await server.listen();
  console.log(
    "Dev browser harness: Void startup migrations disabled; all other Vite plugins retained",
  );
  await run(false);
  await run(true);
} finally {
  await server.close();
}
