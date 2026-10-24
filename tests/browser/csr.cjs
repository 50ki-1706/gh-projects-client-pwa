// Run through run.mjs to configure CSR_BASE_URL (not a Node test).
async (page, origin = "http://localhost:5173") => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const errors = [];
  const expectedHttpErrors = [];
  const modules = new Set();
  const calls = [];
  const external = [];
  const missingPaths = ["/assets/not-present.js", "/assets/not-present.css", "/assets/not-present.png"];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const entry = { text: message.text(), url: message.location().url };
    const expectedAuth = ["/api/auth/get-session", "/api/auth/sign-in/social", "/api/auth/sign-out"]
      .some((path) => entry.url === origin + path) &&
      entry.text === "Failed to load resource: the server responded with a status of 400 (Bad Request)";
    const expectedAsset = missingPaths.some((path) => entry.url === origin + path) &&
      entry.text === "Failed to load resource: the server responded with a status of 404 (Not Found)";
    if (expectedAuth || expectedAsset) {
      expectedHttpErrors.push(entry);
    } else errors.push(entry);
  });
  page.on("response", (response) => {
    if (response.request().resourceType() === "script") modules.add(response.url());
  });
  let session;
  let login;
  let logout;
  const response = (status, body) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
  const anonymous = response(200, null);
  const failure = response(400, { code: "MOCK_FAILURE", message: "Mock failure" });
  const user = { id: "test-id", name: "テストユーザー", email: "test@example.test", image: null };
  const authenticated = response(200, { user, session: { id: "test-session", userId: user.id, expiresAt: "2099-01-01T00:00:00.000Z" } });
  const deferred = () => {
    let release;
    const promise = new Promise((resolve) => { release = resolve; });
    return { promise, release };
  };
  // Install all auth mocks BEFORE the first navigation; external requests never run.
  await page.context().route("**/*", async (route) => {
    const url = route.request().url();
    if (!url.startsWith(origin + "/")) {
      external.push(url);
      return route.abort();
    }
    const path = url.slice(origin.length).split("?")[0];
    if (!path.startsWith("/api/auth/")) return route.continue();
    calls.push({ path, method: route.request().method(), body: route.request().postDataJSON() });
    const mock = path === "/api/auth/get-session" ? session
      : path === "/api/auth/sign-in/social" ? login
      : path === "/api/auth/sign-out" ? logout : null;
    assert(mock, `Unexpected/unmocked auth request: ${path}`);
    await route.fulfill(await mock);
  });
  const visible = async (text) => page.getByText(text, { exact: true }).waitFor();
  const count = (path) => calls.filter((call) => call.path === path).length;
  const navigate = async (mock) => { session = mock; await page.goto(origin); };

  const first = deferred();
  await navigate(first.promise);
  await visible("読み込み中…");
  assert(await page.getByRole("button").count() === 0, "Loading must not offer login");
  first.release(anonymous);
  await visible("GitHubでログイン");
  assert(await page.title() === "GitHub ログイン", "Japanese title");

  const signingIn = deferred();
  login = signingIn.promise;
  await page.getByRole("button", { name: "GitHubでログイン" }).click();
  const pendingLogin = page.getByRole("button", { name: "ログイン中…" });
  await pendingLogin.waitFor();
  assert(await pendingLogin.isDisabled(), "Login pending must be disabled");
  await pendingLogin.evaluate((button) => { button.click(); button.click(); });
  assert(count("/api/auth/sign-in/social") === 1, "Duplicate login request");
  const payload = calls.find((call) => call.path === "/api/auth/sign-in/social");
  assert(payload.method === "POST" && payload.body.provider === "github" && payload.body.callbackURL === "/", "Login request payload/callback");
  signingIn.release(failure);
  await visible("ログインに失敗しました。もう一度お試しください。");
  await visible("GitHubでログイン");

  const sessionsBeforeLoginRetry = count("/api/auth/get-session");
  const retryingLogin = deferred();
  login = retryingLogin.promise;
  await page.getByRole("button", { name: "GitHubでログイン" }).click();
  await pendingLogin.waitFor();
  assert(await pendingLogin.isDisabled(), "Login retry pending must be disabled");
  assert(await page.getByRole("alert").count() === 0, "Login retry clears the old error");
  assert(count("/api/auth/sign-in/social") === 2, "Login retry must issue one request");
  retryingLogin.release(response(200, { redirect: false, url: origin + "/" }));
  await visible("GitHubでログイン");
  assert(await page.getByRole("button", { name: "GitHubでログイン" }).isEnabled(), "Login success clears pending");
  assert(await page.getByRole("alert").count() === 0, "Login success must not show an error");
  assert(await page.locator(".profile").count() === 0, "Login success must not invent a local user");
  assert(count("/api/auth/get-session") === sessionsBeforeLoginRetry, "Login success must not reload the session");

  await navigate(response(200, { user: { ...user, image: 123 } }));
  await visible("セッションの取得に失敗しました。もう一度お試しください。");
  assert(await page.locator(".profile").count() === 0, "Malformed session must not expose a profile");
  session = anonymous;
  await page.getByRole("button", { name: "再試行" }).click();
  await visible("GitHubでログイン");

  await navigate(failure);
  await visible("セッションの取得に失敗しました。もう一度お試しください。");
  const retry = deferred();
  session = retry.promise;
  await page.getByRole("button", { name: "再試行" }).click();
  await visible("読み込み中…");
  retry.release(authenticated);
  await visible(user.name);
  await visible(user.email);
  assert(await page.locator(".profile-image").count() === 0, "Nullable avatar must not render an image");

  const signingOut = deferred();
  logout = signingOut.promise;
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  const pendingLogout = page.getByRole("button", { name: "ログアウト中…" });
  await pendingLogout.waitFor();
  assert(await pendingLogout.isDisabled(), "Logout pending must be disabled");
  await pendingLogout.evaluate((button) => { button.click(); button.click(); });
  assert(count("/api/auth/sign-out") === 1, "Duplicate logout request");
  signingOut.release(failure);
  await visible("ログアウトに失敗しました。もう一度お試しください。");
  await visible(user.name);
  logout = response(200, { success: true });
  const sessionsBeforeLogout = count("/api/auth/get-session");
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await visible("GitHubでログイン");
  assert(await page.getByText(user.name, { exact: true }).count() === 0, "Logout must clear local user");
  assert(count("/api/auth/get-session") === sessionsBeforeLogout, "Logout must not reload the session");
  assert(await page.getByRole("alert").count() === 0, "Successful action clears old error");

  await page.setViewportSize({ width: 320, height: 740 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile layout overflows");
  await navigate(authenticated);
  await visible(user.name);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile profile overflows");

  session = anonymous;
  await page.goto(origin + "/a/deep/link");
  await visible("GitHubでログイン");

  // Explicit document Accept: these probes represent navigation, not script fetches.
  let shell;
  for (const path of ["/", "/a/deep/link"]) {
    const result = await page.request.get(origin + path, { headers: { Accept: "text/html" } });
    const html = await result.text();
    if (path === "/") shell = html;
    assert(result.status() === 200 && /text\/html/.test(result.headers()["content-type"]), `Shell ${path}`);
    assert(/<div id="app"><\/div>/.test(html), `Empty CSR shell ${path}`);
    assert(!/data-hk|__VOID|page-data|hydrate\(/.test(html), `SSR marker ${path}`);
  }
  const docs = await page.request.get(origin + "/docs", { headers: { Accept: "text/html" } });
  assert(docs.status() === 200 && /text\/html/.test(docs.headers()["content-type"]), "Docs HTML");
  assert((await docs.text()).includes("createApiReference"), "Docs route must not become the app shell");
  const openapi = await page.request.get(origin + "/docs/openapi", { headers: { Accept: "application/json" } });
  assert(openapi.status() === 200 && /application\/json/.test(openapi.headers()["content-type"]) && (await openapi.json()).openapi === "3.1.0", "OpenAPI JSON");
  const projects = await page.request.get(origin + "/api/projects", { headers: { Accept: "application/json" } });
  assert(projects.status() === 401 && /application\/json/.test(projects.headers()["content-type"]) && (await projects.json()).error.code === "unauthenticated", "API 401 must not be shell");
  const assets = [];
  const entry = [...shell.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)]
    .map((match) => match[1]).find((path) => path.includes("/assets/") || path.includes("/src/client/main.tsx"));
  const stylesheet = [...shell.matchAll(/\bhref="([^"]+\.css)"/g)][0]?.[1] ?? "/src/client/app.css?direct";
  assert(entry, "Shell must reference the JS entry");
  for (const [path, accept, mime] of [[entry, "application/javascript", /(?:java|ecma)script/], [stylesheet, "text/css", /text\/css/]]) {
    const result = await page.request.get(origin + path, { headers: { Accept: accept } });
    const contentType = result.headers()["content-type"];
    assert(result.status() === 200 && mime.test(contentType), `Actual asset ${path}: ${result.status()} ${contentType}`);
    assets.push({ path, status: result.status(), contentType });
  }
  const missingAssets = [];
  for (const [index, path] of missingPaths.entries()) {
    const result = await page.request.get(origin + path, { headers: {
      Accept: ["application/javascript", "text/css", "image/png"][index],
      "Sec-Fetch-Dest": ["script", "style", "image"][index],
      "Sec-Fetch-Mode": "cors",
    } });
    assert(result.status() === 404, `Missing asset ${path} must be 404, received ${result.status()}`);
    assert(!(await result.text()).includes('<div id="app"></div>'), `Asset ${path} returned a shell`);
    missingAssets.push({ path, status: result.status() });
  }
  const scriptResponse = page.waitForResponse(origin + missingPaths[0]);
  const scriptOutcome = page.evaluate(() => new Promise((resolve) => {
    const script = document.createElement("script");
    script.type = "module";
    script.src = "/assets/not-present.js";
    script.onload = () => resolve("load");
    script.onerror = () => resolve("error");
    document.head.append(script);
  }));
  const actualScript = await scriptResponse;
  assert(actualScript.status() === 404 && await scriptOutcome === "error", "Real missing module script must fail with HTTP 404");
  assert(modules.size > 0, "No script graph observed");
  for (const url of modules) assert(!/\/src\/github\/|\/auth\.ts|better-auth.*\/solid|solid-js.*\/store|@void[+\/]solid/.test(url), `Server/Solid1 module in client: ${url}`);
  assert(external.length === 0, `External requests: ${external.join(", ")}`);
  assert(errors.length === 0, `Browser errors: ${JSON.stringify(errors)}`);
  const summary = { status: "PASS", origin, casesPassed: ["loading/anonymous", "login pending/duplicate/payload/failure/retry/success", "malformed session/retry", "session failure/retry", "authenticated nullable image", "logout pending/failure/preserved user/success", "mobile 320px", "root/deep-link navigation/docs/openapi/API401", "JS/CSS MIME and missing JS/CSS/PNG 404", "real missing module script 404", "no unexpected console/module errors"], assets, missingAssets, authRequests: calls.map(({ path, method }) => ({ path, method })), modules: [...modules], errors, expectedHttpErrors, external };
  await page.evaluate((value) => { window.__csrChecks = value; }, summary);
  return summary;
}
