import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildOpenApiDocument,
  getOpenApiDocument,
} from "../src/api-docs/openapi.ts";
import { errorDefinitions } from "../src/github/errors.ts";
import { projectApp } from "../src/github/rpc.ts";
import { GET as docsPage } from "../routes/docs/index.ts";
import { GET as openApiRoute } from "../routes/docs/openapi.ts";

const PROJECT_ROUTE_ROOT = fileURLToPath(
  new URL("../routes/api/projects", import.meta.url),
);
const ROUTE_METHOD = /export const (GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g;

const EXPECTED_OPERATIONS = {
  "/api/projects": "listProjects",
  "/api/projects/{number}/items": "listProjectItems",
  "/api/projects/{number}/items/{itemId}": "getProjectItem",
};

const EXPECTED_ERROR_CODES = [
  "invalid_request",
  "unauthenticated",
  "github_reauth_required",
  "ambiguous_github_account",
  "not_found",
  "rate_limited",
  "internal_error",
  "github_unavailable",
];

function errorComponentName(code) {
  const suffix = code
    .split("_")
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join("");
  return `Error${suffix}`;
}

function getOperation(spec, path) {
  const operation = spec.paths[path]?.get;
  assert.ok(operation, `missing GET ${path}`);
  return operation;
}

function getParameter(operation, name, location) {
  const parameter = operation.parameters.find(
    (candidate) => candidate.name === name && candidate.in === location,
  );
  assert.ok(parameter, `missing ${location} parameter ${name}`);
  return parameter;
}

function scanProjectRoutes(directory) {
  const scanned = {};

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      Object.assign(scanned, scanProjectRoutes(fullPath));
      continue;
    }
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) continue;

    const segments = relative(PROJECT_ROUTE_ROOT, fullPath)
      .replace(/\\/g, "/")
      .replace(/\.ts$/, "")
      .split("/");
    if (segments.at(-1) === "index") segments.pop();

    const path = [
      "/api/projects",
      ...segments.map((segment) => segment.replace(/^\[(.+)\]$/, "{$1}")),
    ].join("/");
    const source = readFileSync(fullPath, "utf8");
    scanned[path] = [...source.matchAll(ROUTE_METHOD)].map((match) => match[1]);
  }

  return scanned;
}

function forEachObject(value, visit) {
  if (Array.isArray(value)) {
    for (const item of value) forEachObject(item, visit);
    return;
  }
  if (value === null || typeof value !== "object") return;

  visit(value);
  for (const item of Object.values(value)) forEachObject(item, visit);
}

function resolveRef(document, ref) {
  assert.match(ref, /^#\//);
  return ref
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce((value, key) => value?.[key], document);
}

function responseCodes(response) {
  const schema = response.content["application/json"].schema;
  const refs = schema.$ref
    ? [schema.$ref]
    : schema.oneOf.map((item) => item.$ref);
  return refs.map((ref) => ref.slice(ref.lastIndexOf("/") + 1));
}

// Void's single-argument defineHandler is an identity wrapper; Hono performs
// this documented conversion when the route runs. Tests convert the returned
// value the same way so they can inspect status and content type.
function asResponse(value) {
  if (value instanceof Response) return value;
  if (typeof value === "string") {
    return new Response(value, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  return Response.json(value);
}

test("OpenAPI paths and methods match the project route files", () => {
  const spec = buildOpenApiDocument();
  const scanned = scanProjectRoutes(PROJECT_ROUTE_ROOT);
  const expected = Object.fromEntries(
    Object.keys(EXPECTED_OPERATIONS).map((path) => [path, ["GET"]]),
  );

  assert.deepEqual(scanned, expected);
  const routes = Object.fromEntries(
    projectApp.routes
      .filter((route) => route.method === "GET")
      .map((route) => [
        route.path.replace(/:([^/]+)/g, "{$1}"),
        [route.method],
      ]),
  );
  assert.deepEqual(routes, expected);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(spec.paths).map(([path, item]) => [
        path,
        Object.keys(item).map((method) => method.toUpperCase()),
      ]),
    ),
    expected,
  );

  for (const [path, operationId] of Object.entries(EXPECTED_OPERATIONS)) {
    assert.equal(getOperation(spec, path).operationId, operationId);
  }

  assert.equal(spec.openapi, "3.1.0");
  assert.equal(
    spec.jsonSchemaDialect,
    "https://json-schema.org/draft/2020-12/schema",
  );
  assert.deepEqual(spec.servers, [{ url: "/", description: "同一オリジン" }]);
  assert.deepEqual(spec.security, [{ sessionCookie: [] }]);
  assert.equal(spec.components.securitySchemes.sessionCookie.in, "cookie");
  assert.equal(
    spec.components.securitySchemes.sessionCookie.name,
    "better-auth.session_token",
  );
  assert.equal(spec.components.securitySchemes.sessionCookie.type, "apiKey");
  assert.match(
    spec.components.securitySchemes.sessionCookie.description,
    /__Secure-better-auth\.session_token/,
  );
});

test("request parameters preserve string inputs, defaults, patterns, and constraints", () => {
  const spec = buildOpenApiDocument();
  const projects = getOperation(spec, "/api/projects");
  const items = getOperation(spec, "/api/projects/{number}/items");
  const detail = getOperation(spec, "/api/projects/{number}/items/{itemId}");

  assert.deepEqual(
    projects.parameters.map((parameter) => [
      parameter.name,
      parameter.in,
      parameter.required,
    ]),
    [
      ["first", "query", false],
      ["after", "query", false],
    ],
  );
  assert.deepEqual(
    items.parameters.map((parameter) => [
      parameter.name,
      parameter.in,
      parameter.required,
    ]),
    [
      ["number", "path", true],
      ["first", "query", false],
      ["after", "query", false],
      ["archived", "query", false],
    ],
  );
  assert.deepEqual(
    detail.parameters.map((parameter) => [
      parameter.name,
      parameter.in,
      parameter.required,
    ]),
    [
      ["number", "path", true],
      ["itemId", "path", true],
      ["first", "query", false],
      ["labelsAfter", "query", false],
      ["fieldsAfter", "query", false],
    ],
  );

  const listFirst = getParameter(projects, "first", "query");
  assert.equal(listFirst.schema.type, "string");
  assert.equal(listFirst.schema.default, "20");
  assert.equal(listFirst.schema.pattern, "^[0-9]{1,3}$");
  assert.match(listFirst.description, /ASCII/);
  assert.match(listFirst.description, /1〜100/);

  const listAfter = getParameter(projects, "after", "query");
  assert.equal(listAfter.schema.minLength, 1);
  assert.equal(listAfter.schema.maxLength, 2048);
  assert.match(listAfter.description, /制御文字/);

  const number = getParameter(items, "number", "path");
  assert.equal(number.schema.type, "string");
  assert.equal(number.schema.pattern, "^[0-9]{1,10}$");
  assert.match(number.description, /2147483647/);
  assert.match(number.description, /ASCII/);

  const itemFirst = getParameter(items, "first", "query");
  assert.equal(itemFirst.schema.default, "20");
  assert.equal(itemFirst.schema.pattern, "^[0-9]{1,3}$");
  assert.match(itemFirst.description, /1〜100/);

  const archived = getParameter(items, "archived", "query");
  assert.equal(archived.schema.default, "0");
  assert.deepEqual(archived.schema.enum, ["0", "1"]);
  assert.match(archived.description, /アーカイブ/);

  const detailFirst = getParameter(detail, "first", "query");
  assert.equal(detailFirst.schema.default, "100");
  assert.equal(detailFirst.schema.pattern, "^[0-9]{1,3}$");

  const itemId = getParameter(detail, "itemId", "path");
  assert.equal(itemId.schema.minLength, 1);
  assert.equal(itemId.schema.maxLength, 512);
  assert.match(itemId.description, /ProjectV2Item/);
  assert.match(itemId.description, /制御文字/);

  for (const name of ["labelsAfter", "fieldsAfter"]) {
    const cursor = getParameter(detail, name, "query");
    assert.equal(cursor.schema.minLength, 1);
    assert.equal(cursor.schema.maxLength, 2048);
    assert.match(cursor.description, /制御文字/);
  }

  forEachObject(spec, (value) => {
    assert.equal("$schema" in value, false);
  });
});

test("response DTOs include nullable content and normalized field variants", () => {
  const spec = buildOpenApiDocument();
  const schemas = spec.components.schemas;
  const responseNames = [
    "ProjectsResponse",
    "ProjectItemsResponse",
    "ProjectItemResponse",
  ];

  for (const name of responseNames) {
    assert.ok(schemas[name], `missing ${name}`);
    assert.ok(schemas[name].description);
  }

  assert.deepEqual(
    schemas.ProjectItemResponse.properties.project.properties,
    schemas.ProjectItemsResponse.properties.project.properties,
  );

  const task = schemas.ProjectItemsResponse.properties.items.items;
  const content = task.properties.content;
  assert.ok(Array.isArray(content.anyOf));
  assert.ok(content.anyOf.some((schema) => schema.type === "null"));

  const contentVariants = content.anyOf.find((schema) => schema.oneOf).oneOf;
  assert.deepEqual(
    contentVariants.map((schema) => schema.properties.kind.const).sort(),
    ["draftIssue", "issue", "pullRequest"],
  );

  const issue = contentVariants.find(
    (schema) => schema.properties.kind.const === "issue",
  );
  const draftIssue = contentVariants.find(
    (schema) => schema.properties.kind.const === "draftIssue",
  );
  assert.ok(
    issue.properties.labels.anyOf.some((schema) => schema.type === "null"),
  );
  assert.ok(
    issue.properties.body.anyOf.some((schema) => schema.type === "null"),
  );
  assert.deepEqual(draftIssue.properties.labels, { type: "null" });
  assert.deepEqual(draftIssue.properties.url, { type: "null" });
  assert.deepEqual(draftIssue.properties.repository, { type: "null" });

  const fieldVariants = task.properties.fields.properties.nodes.items.oneOf;
  assert.deepEqual(
    fieldVariants.map((schema) => schema.properties.kind.const),
    ["singleSelect", "text", "date", "number", "unsupported"],
  );
  assert.ok(
    task.properties.content.anyOf.some((schema) => schema.oneOf) &&
      task.properties.content.anyOf.some((schema) => schema.type === "null"),
  );

  const pageInfo = task.properties.fields.properties.pageInfo;
  assert.match(pageInfo.description, /hasNextPage/);
  assert.match(pageInfo.description, /endCursor/);
  assert.ok(
    pageInfo.properties.endCursor.anyOf.some(
      (schema) => schema.type === "null",
    ),
  );

  const detailTask = schemas.ProjectItemResponse.properties.item;
  assert.equal(
    detailTask.properties.fields.properties.nodes.items.oneOf.length,
    5,
  );
});

test("error components and responses derive codes, statuses, and messages", () => {
  const spec = buildOpenApiDocument();
  const schemas = spec.components.schemas;
  const errorComponents = Object.entries(schemas).filter(([name]) =>
    name.startsWith("Error"),
  );

  assert.deepEqual(
    errorComponents
      .map(([, schema]) => schema.properties.error.properties.code.const)
      .sort(),
    [...EXPECTED_ERROR_CODES].sort(),
  );
  assert.equal(schemas.ErrorForbidden, undefined);
  assert.equal(errorDefinitions.forbidden.status, 403);

  for (const [name, schema] of errorComponents) {
    const code = schema.properties.error.properties.code.const;
    const message = schema.properties.error.properties.message.const;
    const definition = errorDefinitions[code];
    assert.equal(name, errorComponentName(code));
    assert.equal(message, definition.message);
    assert.equal(
      schema.description,
      `${definition.status} ${code}: ${definition.message}`,
    );
  }

  const expectedStatuses = [
    "200",
    "400",
    "401",
    "403",
    "404",
    "429",
    "500",
    "502",
  ];
  for (const path of Object.keys(EXPECTED_OPERATIONS)) {
    const operation = getOperation(spec, path);
    assert.deepEqual(Object.keys(operation.responses), expectedStatuses);
    assert.ok(operation.responses["404"], `${path} must document 404`);

    for (const response of Object.values(operation.responses)) {
      assert.equal(
        response.headers["Cache-Control"].$ref,
        "#/components/headers/NoStore",
      );
    }

    assert.deepEqual(responseCodes(operation.responses["403"]).sort(), [
      "ErrorAmbiguousGithubAccount",
      "ErrorGithubReauthRequired",
    ]);
    assert.deepEqual(responseCodes(operation.responses["404"]), [
      "ErrorNotFound",
    ]);
    assert.deepEqual(responseCodes(operation.responses["429"]), [
      "ErrorRateLimited",
    ]);
    assert.equal(
      operation.responses["429"].headers["Retry-After"].$ref,
      "#/components/headers/RetryAfter",
    );
    assert.equal(operation.responses["400"].headers["Retry-After"], undefined);
    assert.match(operation.responses["404"].description, /not_found/);
  }

  assert.deepEqual(spec.components.headers.NoStore.schema, {
    type: "string",
    const: "no-store",
  });
  assert.deepEqual(spec.components.headers.RetryAfter.schema, {
    type: "integer",
    minimum: 1,
    maximum: 3600,
  });
});

test("all component references resolve and no auth or upstream schemas leak", () => {
  const spec = buildOpenApiDocument();
  const refs = [];
  forEachObject(spec, (value) => {
    if (typeof value.$ref === "string") refs.push(value.$ref);
  });

  assert.ok(refs.length > 0);
  for (const ref of refs) {
    assert.notEqual(resolveRef(spec, ref), undefined, `unresolved ${ref}`);
  }

  assert.deepEqual(
    Object.keys(spec.components.schemas).sort(),
    [
      ...EXPECTED_ERROR_CODES.map(errorComponentName).sort(),
      "ProjectItemResponse",
      "ProjectItemsResponse",
      "ProjectsResponse",
    ].sort(),
  );

  const serialized = JSON.stringify(spec.components.schemas);
  for (const leaked of [
    "accessToken",
    "githubTokenRows",
    "graphqlEnvelope",
    "Authorization",
    "Bearer",
  ]) {
    assert.equal(serialized.includes(leaked), false, `leaked ${leaked}`);
  }
});

test("document generation is deterministic and cached lazily", () => {
  const first = buildOpenApiDocument();
  const second = buildOpenApiDocument();
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(getOpenApiDocument(), getOpenApiDocument());
  assert.ok(JSON.stringify(first).length > 1_000);
});

test("operation and general descriptions keep the non-derivable semantics", () => {
  const spec = buildOpenApiDocument();
  const projects = getOperation(spec, "/api/projects");
  const items = getOperation(spec, "/api/projects/{number}/items");
  const detail = getOperation(spec, "/api/projects/{number}/items/{itemId}");

  assert.match(spec.info.description, /個人（User）所有/);
  assert.match(
    spec.info.description,
    /この API のために追加するスコープは `read:project` だけです/,
  );
  assert.match(spec.info.description, /既定スコープは変更しません/);
  assert.doesNotMatch(spec.info.description, /スコープは `read:project` のみ/);
  assert.match(
    spec.info.description,
    /`repo` \/ `write:\*` \/ `project` は追加しません/,
  );
  assert.match(spec.info.description, /8秒/);
  assert.match(spec.info.description, /Cache-Control: no-store/);
  assert.match(spec.info.description, /redact/);
  assert.match(projects.description, /totalCount/);
  assert.match(projects.description, /Organization/);
  assert.match(items.description, /archived=1/);
  assert.match(items.description, /DraftIssue/);
  assert.match(items.description, /404 not_found/);
  assert.match(detail.description, /最大2回/);
  assert.match(detail.description, /再確認/);
  assert.match(detail.description, /unsupported/);
  assert.match(detail.description, /502 github_unavailable/);
});

test("README points to the API documentation", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

  assert.match(readme, /\/docs\b/);
  assert.match(readme, /\/docs\/openapi\b/);
});

test("docs page uses the pinned Scalar ESM build with a JSON fallback", async () => {
  const value = await docsPage({});
  assert.equal(typeof value, "string");
  const response = asResponse(value);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);

  const html = await response.text();
  assert.match(
    html,
    /https:\/\/cdn\.jsdelivr\.net\/npm\/@scalar\/api-reference@1\.75\.1\/esm\.js/,
  );
  assert.match(
    html,
    /createApiReference\("#app", \{ url: "\/docs\/openapi" \}\)/,
  );
  assert.match(html, /href="\/docs\/openapi"/);
  assert.match(html, /CDN を読み込めない場合/);
  assert.doesNotMatch(html, /authorization|bearer/i);
});

test("docs routes are public and do not touch GitHub or authentication", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("docs must not call GitHub");
  };

  try {
    const pageValue = await docsPage({});
    assert.equal(typeof pageValue, "string");
    assert.equal(asResponse(pageValue).status, 200);

    const value = await openApiRoute({});
    assert.ok(value && typeof value === "object");
    assert.equal(value instanceof Response, false);
    const response = asResponse(value);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/json/);
    const body = await response.json();
    assert.equal(JSON.stringify(body), JSON.stringify(buildOpenApiDocument()));
    assert.equal(body.security.length, 1);
    assert.equal(body.components.securitySchemes.sessionCookie.in, "cookie");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
