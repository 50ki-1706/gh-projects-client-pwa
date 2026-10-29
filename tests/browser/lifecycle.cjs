async (existingPage, origin) => {
  const context = await existingPage.context().browser().newContext();
  const page = await context.newPage();
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const errors = [];
  const expectedHttpErrors = [];
  const external = [];
  const requests = [];
  const queues = {
    "/api/auth/get-session": [],
    "/api/auth/sign-in/social": [],
    "/api/auth/sign-out": [],
  };
  const reply = (user = null) => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(user ? { user } : null),
  });
  const user = {
    id: "old",
    name: "Stale user",
    email: "stale@example.test",
    image: null,
  };
  const defer = (path) => {
    let release;
    const promise = new Promise((resolve) => {
      release = resolve;
    });
    queues[path].push(promise);
    return release;
  };
  const session = () => defer("/api/auth/get-session");
  const login = () => defer("/api/auth/sign-in/social");
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (
      message.location().url === origin + "/api/auth/sign-in/social" &&
      message.text() ===
        "Failed to load resource: the server responded with a status of 400 (Bad Request)"
    )
      expectedHttpErrors.push(message.text());
    else errors.push(message.text());
  });
  // Fresh isolated page, all routes installed before navigation or any mount.
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (!url.startsWith(origin + "/")) {
      external.push(url);
      return route.abort();
    }
    const path = url.slice(origin.length).split("?")[0];
    if (!path.startsWith("/api/auth/")) return route.continue();
    const mock = queues[path]?.shift();
    assert(mock, `Unexpected lifecycle request ${path}`);
    requests.push(path);
    await route.fulfill(await mock);
  });
  const waitRequests = async (count) => {
    const deadline = Date.now() + 10000;
    while (requests.length < count && Date.now() < deadline)
      await page.waitForTimeout(10);
    assert(
      requests.length === count,
      `Expected ${count} lifecycle requests, got ${requests.length}`,
    );
  };
  const visible = (text) => page.getByText(text, { exact: true }).waitFor();
  const mount = (strict) =>
    page.evaluate((value) => window.lifecycleFixture.mount(value), strict);
  const unmount = () => page.evaluate(() => window.lifecycleFixture.unmount());
  // Drain response parsing and React updates, without asserting before a stale reply arrives.
  const release = async (resolve, response) => {
    const received = page.waitForResponse((r) =>
      r.url().includes("/api/auth/"),
    );
    resolve(response);
    await (await received).finished();
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  };
  try {
    await page.goto(origin + "/tests/browser/lifecycle.html");
    await page.waitForFunction(() => !!window.lifecycleFixture);
    const oldStrict = session();
    const currentStrict = session();
    await mount(true);
    await waitRequests(2);
    await visible("読み込み中…");
    await release(currentStrict, reply());
    await visible("GitHubでログイン");
    const action = login();
    await page.getByRole("button", { name: "GitHubでログイン" }).click();
    await waitRequests(3);
    await release(oldStrict, reply(user));
    assert(
      await page.getByRole("button", { name: "ログイン中…" }).isDisabled(),
      "Stale StrictMode finally cleared current pending",
    );
    assert(
      (await page.getByText(user.name).count()) === 0,
      "Superseded session overwrote current user",
    );
    await release(action, {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ redirect: false, url: origin + "/" }),
    });
    await visible("GitHubでログイン");
    await unmount();

    const oldSession = session();
    await mount(false);
    await waitRequests(4);
    await unmount();
    const newSession = session();
    await mount(false);
    await waitRequests(5);
    await release(oldSession, reply({ ...user, image: 123 }));
    await visible("読み込み中…");
    assert(
      (await page.getByText(user.name).count()) === 0,
      "Unmounted session committed to new root",
    );
    await release(newSession, reply());
    await visible("GitHubでログイン");

    const oldAction = login();
    await page.getByRole("button", { name: "GitHubでログイン" }).click();
    await waitRequests(6);
    await unmount();
    const remounted = session();
    await mount(false);
    await waitRequests(7);
    await release(remounted, reply());
    await visible("GitHubでログイン");
    const newAction = login();
    await page.getByRole("button", { name: "GitHubでログイン" }).click();
    await waitRequests(8);
    await release(oldAction, {
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ code: "MOCK_FAILURE", message: "Mock failure" }),
    });
    assert(
      await page.getByRole("button", { name: "ログイン中…" }).isDisabled(),
      "Unmounted action cleared new pending",
    );
    assert(
      (await page.getByRole("alert").count()) === 0,
      "Unmounted action leaked error",
    );
    await release(newAction, {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ redirect: false, url: origin + "/" }),
    });
    await visible("GitHubでログイン");
    assert(
      await page.getByRole("button").isEnabled(),
      "New root stuck pending",
    );
    assert(
      errors.length === 0,
      `Lifecycle browser errors: ${JSON.stringify(errors)}`,
    );
    assert(external.length === 0, `Lifecycle external requests: ${external}`);
    return {
      status: "PASS",
      casesPassed: [
        "StrictMode replay/superseded session/current pending",
        "unmount pending session/stale error/remount",
        "unmount pending action/stale error/remount/current pending",
      ],
      requests,
      errors,
      expectedHttpErrors,
      external,
    };
  } finally {
    await context.close();
  }
};
