import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import config from "../void.config.ts";
import { projectSessionUser } from "../src/client/session.ts";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("CSR shell owns metadata and has an empty mount point", () => {
  const html = source("../index.html");
  assert.match(html, /<html lang="ja">/);
  assert.match(html, /<meta charset="utf-8"/);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(html, /<title>GitHub ログイン<\/title>/);
  assert.match(html, /<div id="app"><\/div>/);
  assert.match(html, /type="module" src="\/src\/client\/main.tsx"/);
  assert.doesNotMatch(html, /hydrate|data-hk|__VOID|page-data/);
  assert.match(source("../src/client/main.tsx"), /import \{ render \} from "@solidjs\/web"/);
  assert.equal(existsSync(new URL("../src/client/styles.d.ts", import.meta.url)), true);
});

test("Void keeps the API worker with SPA fallback, not Pages or Solid Start", () => {
  assert.equal(config.inference.appType, "void");
  assert.equal(config.routing?.notFound, undefined);
  // Document routes make Void infer worker-owned HTML navigation fallback.
  assert.equal(existsSync(new URL("../routes/docs/index.ts", import.meta.url)), true);
  assert.deepEqual(config.auth.providers, ["github"]);
  assert.equal(config.worker.compatibility_date, "2026-02-24");
  assert.equal(config.head, undefined);
  assert.equal(existsSync(new URL("../pages", import.meta.url)), false);
  const pkg = JSON.parse(source("../package.json"));
  assert.equal(pkg.dependencies["@void/solid"], undefined);
  assert.equal(pkg.dependencies["solid-js"], "2.0.0-rc.18");
  assert.equal(pkg.dependencies["@solidjs/web"], "2.0.0-rc.18");
  assert.equal(pkg.devDependencies["@solidjs/vite-plugin"], "3.0.0-next.51");
  assert.equal(pkg.devDependencies.void, "1.2.1");
  const vite = source("../vite.config.ts");
  assert.match(vite, /voidPlugin\(\), solidPlugin\(\{ ssr: false \}\)/);
  assert.doesNotMatch(vite, /@void\/solid|start:|serverFunctions:/);
  const tsconfig = JSON.parse(source("../tsconfig.json"));
  assert.equal(tsconfig.compilerOptions.jsxImportSource, "@solidjs/web");
  assert.equal(tsconfig.include.includes("pages"), false);
});

test("generic auth envelope projects only public profile fields", () => {
  assert.equal(projectSessionUser({ data: null, error: null }), null);
  const user = { name: "テスト", email: "test@example.test", image: null, id: "private-id" };
  const result = { data: { user, session: { token: "test-only" } }, error: null };
  assert.deepEqual(projectSessionUser(result), {
    name: user.name, email: user.email, image: null,
  });
  delete user.image;
  assert.equal(projectSessionUser(result).image, null);
  user.image = "/avatar.png";
  assert.equal(projectSessionUser(result).image, "/avatar.png");
  assert.throws(() => projectSessionUser({ data: null, error: { message: "failure" } }));
});

test("malformed auth envelopes and profiles fail closed instead of becoming anonymous", () => {
  for (const value of [
    null, undefined, false, 1, "session", [], {},
    { data: null }, { error: null }, { data: null, error: false },
    { data: null, error: {} }, { data: null, error: "failure" },
    { data: {}, error: null }, { data: [], error: null },
    { data: { user: null }, error: null }, { data: { user: [] }, error: null },
    { data: { user: {} }, error: null },
    { data: { user: { name: "name" } }, error: null },
    { data: { user: { email: "email" } }, error: null },
    { data: { user: { name: null, email: "email" } }, error: null },
    { data: { user: { name: "name", email: 123 } }, error: null },
    ...[false, 123, {}, []].map((image) => ({
      data: { user: { name: "name", email: "email", image } }, error: null,
    })),
  ]) {
    assert.throws(() => projectSessionUser(value), `accepted ${JSON.stringify(value)}`);
  }
});
