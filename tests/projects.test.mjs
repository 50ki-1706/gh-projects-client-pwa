import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { Hono } from "hono";
import * as v from "valibot";
import { authContext } from "void/auth";
import { createProjectApp, projectApp } from "../src/github/rpc.ts";
import {
  createProjectsClient,
  encodeProjectPathSegment,
} from "../src/client/projects-rpc.ts";
import auth from "../auth.ts";
import { GitHubApiError, toErrorResponse } from "../src/github/errors.ts";
import {
  getProjectItem,
  listProjectItems,
  listProjects,
} from "../src/github/projects.ts";
import {
  PROJECT_ITEMS_QUERY,
  PROJECT_ITEM_ACCESS_QUERY,
  PROJECT_ITEM_DETAIL_QUERY,
  PROJECTS_QUERY,
} from "../src/github/queries.ts";
import {
  projectItemParamsSchema,
  projectItemQuerySchema,
  projectItemsQuerySchema,
  projectParamsSchema,
  projectsQuerySchema,
} from "../src/github/schemas.ts";
import { selectGitHubAccessToken } from "../src/github/token.ts";
import { GET as listProjectsRoute } from "../routes/api/projects/index.ts";
import { GET as listItemsRoute } from "../routes/api/projects/[number]/items.ts";
import { GET as itemDetailRoute } from "../routes/api/projects/[number]/items/[itemId].ts";

const VIEWER_ID = "U_VIEWER";
const PROJECT_ID = "PVT_PROJECT";
const ITEM_ID = "PVTI_ITEM";
const CREATED_AT = "2026-01-01T00:00:00Z";
const UPDATED_AT = "2026-01-02T00:00:00Z";
const TEST_TOKEN = "gho_testtoken";

function owner(id = VIEWER_ID, typename = "User") {
  return { __typename: typename, id };
}

function projectMetadata(overrides = {}) {
  return {
    id: PROJECT_ID,
    number: 7,
    title: "Roadmap",
    shortDescription: null,
    owner: owner(),
    ...overrides,
  };
}

function projectListItem(overrides = {}) {
  return {
    ...projectMetadata(),
    url: "https://github.com/users/alice/projects/7",
    closed: false,
    public: true,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function pageInfo(hasNextPage = false, endCursor = null) {
  return { hasNextPage, endCursor };
}

function labels(nodes = [], info = pageInfo()) {
  return { nodes, pageInfo: info };
}

function label(overrides = {}) {
  return {
    id: "L_1",
    name: "bug",
    color: "ff0000",
    description: null,
    ...overrides,
  };
}

function issueContent(overrides = {}) {
  return {
    __typename: "Issue",
    title: "Issue title",
    body: null,
    url: "https://github.com/alice/repo/issues/1",
    number: 1,
    state: "OPEN",
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    repository: {
      nameWithOwner: "alice/repo",
      url: "https://github.com/alice/repo",
    },
    labels: labels([label()]),
    ...overrides,
  };
}

function pullRequestContent(overrides = {}) {
  return {
    ...issueContent(),
    __typename: "PullRequest",
    title: "PR title",
    url: "https://github.com/alice/repo/pull/2",
    number: 2,
    state: "MERGED",
    labels: null,
    ...overrides,
  };
}

function draftIssueContent(overrides = {}) {
  return {
    __typename: "DraftIssue",
    title: "Draft title",
    body: "Draft body",
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function task(overrides = {}) {
  return {
    id: ITEM_ID,
    type: "ISSUE",
    isArchived: false,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    content: issueContent(),
    fieldValues: { nodes: [], pageInfo: pageInfo() },
    ...overrides,
  };
}

function projectItemsData(tasks, itemsOverrides = {}, projectOverrides = {}) {
  return {
    viewer: {
      id: VIEWER_ID,
      projectV2: {
        ...projectMetadata(),
        items: {
          nodes: tasks,
          pageInfo: itemsOverrides.pageInfo ?? pageInfo(),
        },
        ...projectOverrides,
      },
    },
  };
}

function projectsData(nodes, options = {}) {
  return {
    viewer: {
      id: VIEWER_ID,
      projectsV2: {
        nodes,
        pageInfo: options.pageInfo ?? pageInfo(),
        totalCount: options.totalCount ?? nodes.length,
      },
    },
  };
}

function detailNode(overrides = {}) {
  return {
    __typename: "ProjectV2Item",
    ...task(),
    project: {
      id: PROJECT_ID,
      owner: owner(),
    },
    ...overrides,
  };
}

function itemAccessData(options = {}) {
  return {
    viewer: {
      id: VIEWER_ID,
      projectV2:
        options.project === undefined ? projectMetadata() : options.project,
    },
    node:
      options.node === undefined
        ? {
            __typename: "ProjectV2Item",
            id: ITEM_ID,
            project: { id: PROJECT_ID },
          }
        : options.node,
  };
}

function jsonResponse(value, init) {
  return Response.json(value, init);
}

function dataResponse(value, init) {
  return Response.json({ data: value }, init);
}

function fakeFetch(...responses) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({
        url,
        init,
        body: JSON.parse(init.body),
      });
      if (responses.length === 0) {
        throw new Error("unexpected fetch");
      }
      const next = responses.shift();
      return typeof next === "function" ? next(url, init) : next;
    },
  };
}

async function expectGitHubError(promise, code, status) {
  try {
    await promise;
    assert.fail(`expected ${code}`);
  } catch (error) {
    assert.ok(error instanceof GitHubApiError);
    assert.equal(error.code, code);
    if (status !== undefined) {
      assert.equal(error.status, status);
    }
    return error;
  }
}

function expectSyncGitHubError(callback, code) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof GitHubApiError);
    assert.equal(error.code, code);
    return true;
  });
}

function routeContext(options = {}) {
  const { number, itemId } = options.params ?? {};
  const path =
    number === undefined
      ? "/api/projects"
      : `/api/projects/${encodeURIComponent(number)}/items${itemId === undefined ? "" : `/${encodeURIComponent(itemId)}`}`;
  return {
    req: {
      raw: new Request(
        `http://localhost${path}?${new URLSearchParams(options.query ?? {})}`,
      ),
    },
    env: {},
  };
}

test("query validation applies defaults and ignores unknown parameters", () => {
  assert.deepEqual(v.parse(projectsQuerySchema, {}), { first: 20 });
  assert.deepEqual(v.parse(projectItemsQuerySchema, {}), {
    first: 20,
    archived: false,
  });
  assert.deepEqual(v.parse(projectItemQuerySchema, {}), { first: 100 });

  const parsed = v.parse(projectsQuerySchema, {
    first: "001",
    after: "cursor",
    owner: "attacker",
    account: "other",
  });
  assert.deepEqual(parsed, { first: 1, after: "cursor" });
  assert.equal("owner" in parsed, false);
  assert.equal("account" in parsed, false);
});

test("query validation rejects out-of-range or malformed values", () => {
  for (const first of [
    "",
    "0",
    "101",
    "1000",
    "1.0",
    "+1",
    "-1",
    " 1",
    "abc",
  ]) {
    assert.throws(() => v.parse(projectsQuerySchema, { first }), v.ValiError);
  }

  for (const archived of ["", "2", "true", "false", "01"]) {
    assert.throws(
      () => v.parse(projectItemsQuerySchema, { archived }),
      v.ValiError,
    );
  }

  assert.equal(
    v.parse(projectItemsQuerySchema, { archived: "1" }).archived,
    true,
  );
  assert.equal(
    v.parse(projectItemsQuerySchema, { archived: "0" }).archived,
    false,
  );
});

test("cursor and path validation rejects control characters and excessive length", () => {
  for (const after of [
    "",
    "a".repeat(2049),
    "\u0000",
    "\u001f",
    "\u007f",
    "\u0085",
  ]) {
    assert.throws(() => v.parse(projectsQuerySchema, { after }), v.ValiError);
  }
  assert.equal(
    v.parse(projectsQuerySchema, { after: "a".repeat(2048) }).after.length,
    2048,
  );

  for (const value of [
    "0",
    "2147483648",
    "9999999999",
    "00000000001",
    "1.5",
    " 1",
  ]) {
    assert.throws(
      () => v.parse(projectParamsSchema, { number: value }),
      v.ValiError,
    );
  }
  assert.equal(
    v.parse(projectParamsSchema, { number: "2147483647" }).number,
    2147483647,
  );
  assert.equal(
    v.parse(projectParamsSchema, { number: "0000000001" }).number,
    1,
  );

  for (const itemId of ["", "a".repeat(513), "\u0000x", "x\u009f"]) {
    assert.throws(
      () => v.parse(projectItemParamsSchema, { number: "1", itemId }),
      v.ValiError,
    );
  }
  assert.equal(
    v.parse(projectItemParamsSchema, { number: "1", itemId: "a".repeat(512) })
      .itemId.length,
    512,
  );
});

test("auth config uniquely appends read:project and preserves existing options", () => {
  const config = auth({
    defaults: {
      baseURL: "http://localhost",
      trustedOrigins: ["http://localhost"],
      socialProviders: {
        github: {
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
          scope: ["user:email", "read:project"],
          disableDefaultScope: true,
          prompt: "select_account",
        },
      },
    },
    env: {},
    dialect: "sqlite",
    request: new Request("http://localhost/api/auth"),
  });

  const github = config.socialProviders.github;
  assert.equal(github.clientId, "test-client-id");
  assert.equal(github.clientSecret, "test-client-secret");
  assert.equal(github.disableDefaultScope, true);
  assert.equal(github.prompt, "select_account");
  assert.deepEqual(github.scope, ["user:email", "read:project"]);
  assert.equal(
    github.scope.filter((scope) => scope === "read:project").length,
    1,
  );
  assert.equal(github.scope.includes("repo"), false);
  assert.equal(github.scope.includes("project"), false);
  assert.equal(
    github.scope.some((scope) => scope.startsWith("write:")),
    false,
  );
  assert.deepEqual(config.trustedOrigins, ["http://localhost"]);

  assert.throws(
    () =>
      auth({
        defaults: {
          socialProviders: {},
        },
        env: {},
        dialect: "sqlite",
        request: new Request("http://localhost/api/auth"),
      }),
    /GitHub/,
  );
});

test("query documents are bounded and do not request organization or option data", () => {
  assert.doesNotMatch(PROJECTS_QUERY, /organization/i);
  assert.doesNotMatch(PROJECT_ITEMS_QUERY, /organization/i);
  assert.doesNotMatch(PROJECT_ITEM_ACCESS_QUERY, /organization/i);
  assert.doesNotMatch(PROJECT_ITEM_DETAIL_QUERY, /organization/i);

  for (const query of [
    PROJECTS_QUERY,
    PROJECT_ITEMS_QUERY,
    PROJECT_ITEM_DETAIL_QUERY,
  ]) {
    assert.doesNotMatch(query, /ProjectV2ItemFieldLabelValue/);
    assert.doesNotMatch(query, /\boptions\s*[({]/);
    assert.doesNotMatch(query, /\bassignees\b/);
  }

  assert.match(PROJECTS_QUERY, /field:\s*UPDATED_AT,\s*direction:\s*DESC/);
  assert.equal((PROJECTS_QUERY.match(/totalCount/g) ?? []).length, 1);
  assert.match(
    PROJECT_ITEMS_QUERY,
    /items\(\s*first:\s*\$first[\s\S]*archivedStates:\s*\$archivedStates/,
  );
  assert.match(
    PROJECT_ITEM_ACCESS_QUERY,
    /node\(id: \$itemId\) \{\s*__typename\s*\.\.\. on ProjectV2Item \{\s*id\s*project \{\s*id\s*\}/,
  );
  assert.doesNotMatch(
    PROJECT_ITEM_ACCESS_QUERY,
    /fieldValues|labels\s*\(|\bbody\b|\bcontent\b/,
  );
  assert.match(
    PROJECT_ITEM_DETAIL_QUERY,
    /labels\(first: \$labelsFirst, after: \$labelsAfter\)/,
  );
  assert.match(
    PROJECT_ITEM_DETAIL_QUERY,
    /fieldValues\(first: \$fieldsFirst, after: \$fieldsAfter\)/,
  );
});

test("list projects returns project counts, closed state, and nullable fields", async () => {
  const fake = fakeFetch(
    dataResponse(
      projectsData(
        [
          projectListItem(),
          projectListItem({
            id: "PVT_CLOSED",
            number: 8,
            title: "Closed project",
            shortDescription: "Finished",
            closed: true,
            public: false,
          }),
        ],
        { pageInfo: pageInfo(true, "PROJECT_CURSOR"), totalCount: 42 },
      ),
    ),
  );

  const result = await listProjects({
    token: TEST_TOKEN,
    first: 20,
    after: "AFTER",
    fetchImpl: fake.fetchImpl,
  });

  assert.deepEqual(result, {
    projects: [
      {
        id: PROJECT_ID,
        number: 7,
        title: "Roadmap",
        shortDescription: null,
        url: "https://github.com/users/alice/projects/7",
        closed: false,
        public: true,
        updatedAt: UPDATED_AT,
      },
      {
        id: "PVT_CLOSED",
        number: 8,
        title: "Closed project",
        shortDescription: "Finished",
        url: "https://github.com/users/alice/projects/7",
        closed: true,
        public: false,
        updatedAt: UPDATED_AT,
      },
    ],
    pageInfo: { hasNextPage: true, endCursor: "PROJECT_CURSOR" },
    totalCount: 42,
  });

  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].url, "https://api.github.com/graphql");
  assert.equal(
    fake.calls[0].init.headers.Authorization,
    `Bearer ${TEST_TOKEN}`,
  );
  assert.equal(
    fake.calls[0].init.headers["User-Agent"],
    "gh-projects-viewer-pwa/1.0",
  );
  assert.deepEqual(fake.calls[0].body.variables, { first: 20, after: "AFTER" });
  assert.equal(JSON.stringify(fake.calls[0].body).includes(TEST_TOKEN), false);
});

test("list projects accepts empty pages and rejects foreign owners and null nodes", async () => {
  const empty = fakeFetch(
    dataResponse(
      projectsData([], { pageInfo: pageInfo(false, null), totalCount: 0 }),
    ),
  );
  assert.deepEqual(
    await listProjects({
      token: TEST_TOKEN,
      first: 20,
      fetchImpl: empty.fetchImpl,
    }),
    {
      projects: [],
      pageInfo: { hasNextPage: false, endCursor: null },
      totalCount: 0,
    },
  );

  for (const nodes of [
    [projectListItem({ owner: owner("U_OTHER") })],
    [projectListItem({ owner: owner("O_ORG", "Organization") })],
    [null],
  ]) {
    const fake = fakeFetch(dataResponse(projectsData(nodes)));
    await expectGitHubError(
      listProjects({ token: TEST_TOKEN, first: 20, fetchImpl: fake.fetchImpl }),
      "github_unavailable",
      502,
    );
  }
});

test("list project items maps issue, pull request, draft, redacted, and null content", async () => {
  const tasks = [
    task(),
    task({
      id: "PVTI_PR",
      type: "PULL_REQUEST",
      isArchived: true,
      content: pullRequestContent(),
    }),
    task({
      id: "PVTI_DRAFT",
      type: "DRAFT_ISSUE",
      content: draftIssueContent(),
    }),
    task({
      id: "PVTI_REDACTED",
      type: "REDACTED",
      content: null,
    }),
    task({
      id: "PVTI_NULL_CONTENT",
      type: "ISSUE",
      content: null,
    }),
  ];
  const fake = fakeFetch(
    dataResponse(
      projectItemsData(tasks, { pageInfo: pageInfo(true, "ITEM_CURSOR") }),
    ),
  );

  const result = await listProjectItems({
    token: TEST_TOKEN,
    number: 7,
    first: 20,
    archived: false,
    fetchImpl: fake.fetchImpl,
  });

  assert.deepEqual(result.project, {
    id: PROJECT_ID,
    number: 7,
    title: "Roadmap",
    shortDescription: null,
  });
  assert.deepEqual(result.pageInfo, {
    hasNextPage: true,
    endCursor: "ITEM_CURSOR",
  });
  assert.equal(result.items.length, 5);

  assert.equal(result.items[0].type, "ISSUE");
  assert.deepEqual(result.items[0].content, {
    kind: "issue",
    title: "Issue title",
    body: null,
    url: "https://github.com/alice/repo/issues/1",
    number: 1,
    state: "OPEN",
    repository: {
      nameWithOwner: "alice/repo",
      url: "https://github.com/alice/repo",
    },
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    labels: {
      nodes: [label()],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  });
  assert.equal(result.items[1].content.kind, "pullRequest");
  assert.equal(result.items[1].content.labels, null);
  assert.equal(result.items[1].isArchived, true);
  assert.deepEqual(result.items[2].content, {
    kind: "draftIssue",
    title: "Draft title",
    body: "Draft body",
    url: null,
    number: null,
    repository: null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    labels: null,
  });
  assert.equal(result.items[3].content, null);
  assert.equal(result.items[4].content, null);

  assert.deepEqual(fake.calls[0].body.variables.archivedStates, [
    "NOT_ARCHIVED",
  ]);
  assert.equal(fake.calls[0].body.variables.labelsFirst, 100);
  assert.equal(fake.calls[0].body.variables.fieldsFirst, 100);
  assert.equal(fake.calls[0].body.variables.labelsAfter, null);
  assert.equal(fake.calls[0].body.variables.fieldsAfter, null);
});

test("list project items includes archived items only when requested", async () => {
  const fake = fakeFetch(
    dataResponse(projectItemsData([task({ isArchived: true })])),
  );
  const result = await listProjectItems({
    token: TEST_TOKEN,
    number: 7,
    first: 20,
    archived: true,
    fetchImpl: fake.fetchImpl,
  });

  assert.equal(result.items[0].isArchived, true);
  assert.deepEqual(fake.calls[0].body.variables.archivedStates, [
    "ARCHIVED",
    "NOT_ARCHIVED",
  ]);
});

test("GitHub fieldValues are normalized into the API fields property", async () => {
  const upstream = task({
    fieldValues: {
      nodes: [
        {
          __typename: "ProjectV2ItemFieldTextValue",
          text: "Ship it",
          field: { id: "F_NOTES", name: "Notes", dataType: "TEXT" },
        },
      ],
      pageInfo: pageInfo(true, "NEXT_FIELD"),
    },
  });
  assert.equal("fields" in upstream, false);
  const fake = fakeFetch(dataResponse(projectItemsData([upstream])));
  const result = await listProjectItems({
    token: TEST_TOKEN,
    number: 7,
    first: 20,
    archived: false,
    fetchImpl: fake.fetchImpl,
  });
  assert.deepEqual(result.items[0].fields, {
    nodes: [
      {
        kind: "text",
        fieldId: "F_NOTES",
        name: "Notes",
        dataType: "TEXT",
        value: "Ship it",
      },
    ],
    pageInfo: { hasNextPage: true, endCursor: "NEXT_FIELD" },
  });
  assert.equal("fieldValues" in result.items[0], false);
});

test("upstream URLs, timestamps, and pagination cursors must be usable", async () => {
  for (const project of [
    projectListItem({ url: "invalid-url" }),
    projectListItem({ updatedAt: "yesterday" }),
  ]) {
    const fake = fakeFetch(dataResponse(projectsData([project])));
    await expectGitHubError(
      listProjects({ token: TEST_TOKEN, first: 20, fetchImpl: fake.fetchImpl }),
      "github_unavailable",
      502,
    );
  }

  for (const info of [
    pageInfo(true, null),
    pageInfo(true, ""),
    pageInfo(true, "bad\u0000cursor"),
    pageInfo(true, "a".repeat(2049)),
  ]) {
    const fake = fakeFetch(dataResponse(projectsData([], { pageInfo: info })));
    await expectGitHubError(
      listProjects({ token: TEST_TOKEN, first: 20, fetchImpl: fake.fetchImpl }),
      "github_unavailable",
      502,
    );
  }
});

test("list project items rejects missing, organization, and foreign projects with 404", async () => {
  for (const projectV2 of [
    null,
    {
      ...projectMetadata(),
      owner: owner("O_ORG", "Organization"),
      items: { nodes: [], pageInfo: pageInfo() },
    },
    {
      ...projectMetadata(),
      owner: owner("U_OTHER"),
      items: { nodes: [], pageInfo: pageInfo() },
    },
  ]) {
    const fake = fakeFetch(
      dataResponse({ viewer: { id: VIEWER_ID, projectV2 } }),
    );
    await expectGitHubError(
      listProjectItems({
        token: TEST_TOKEN,
        number: 7,
        first: 20,
        archived: false,
        fetchImpl: fake.fetchImpl,
      }),
      "not_found",
      404,
    );
  }
});

test("list project items accepts empty items and rejects null item or label nodes", async () => {
  const empty = fakeFetch(dataResponse(projectItemsData([])));
  assert.deepEqual(
    (
      await listProjectItems({
        token: TEST_TOKEN,
        number: 7,
        first: 20,
        archived: false,
        fetchImpl: empty.fetchImpl,
      })
    ).items,
    [],
  );

  const nullItem = fakeFetch(dataResponse(projectItemsData([null])));
  await expectGitHubError(
    listProjectItems({
      token: TEST_TOKEN,
      number: 7,
      first: 20,
      archived: false,
      fetchImpl: nullItem.fetchImpl,
    }),
    "github_unavailable",
    502,
  );

  const nullLabel = fakeFetch(
    dataResponse(
      projectItemsData([
        task({
          content: issueContent({
            labels: labels([null]),
          }),
        }),
      ]),
    ),
  );
  await expectGitHubError(
    listProjectItems({
      token: TEST_TOKEN,
      number: 7,
      first: 20,
      archived: false,
      fetchImpl: nullLabel.fetchImpl,
    }),
    "github_unavailable",
    502,
  );
});

test("item detail uses a proof query, then normalizes all supported field kinds", async () => {
  const fields = [
    {
      __typename: "ProjectV2ItemFieldSingleSelectValue",
      name: null,
      optionId: null,
      field: { id: "F_STATUS", name: "Status", dataType: "SINGLE_SELECT" },
    },
    {
      __typename: "ProjectV2ItemFieldTextValue",
      text: null,
      field: { id: "F_TEXT", name: "Notes", dataType: "TEXT" },
    },
    {
      __typename: "ProjectV2ItemFieldDateValue",
      date: "2026-02-03",
      field: { id: "F_DATE", name: "Due", dataType: "DATE" },
    },
    {
      __typename: "ProjectV2ItemFieldNumberValue",
      number: 1.25,
      field: { id: "F_NUMBER", name: "Estimate", dataType: "NUMBER" },
    },
    {
      __typename: "ProjectV2ItemFieldIterationValue",
    },
  ];
  const fake = fakeFetch(
    dataResponse(itemAccessData()),
    dataResponse({
      node: detailNode({
        fieldValues: {
          nodes: fields,
          pageInfo: pageInfo(true, "FIELD_CURSOR"),
        },
      }),
    }),
  );

  const result = await getProjectItem({
    token: TEST_TOKEN,
    number: 7,
    itemId: ITEM_ID,
    first: 100,
    labelsAfter: "LABEL_CURSOR",
    fieldsAfter: "FIELDS_CURSOR",
    fetchImpl: fake.fetchImpl,
  });

  assert.deepEqual(result.project, {
    id: PROJECT_ID,
    number: 7,
    title: "Roadmap",
    shortDescription: null,
  });
  assert.deepEqual(result.item.fields, {
    nodes: [
      {
        kind: "singleSelect",
        fieldId: "F_STATUS",
        name: "Status",
        dataType: "SINGLE_SELECT",
        optionId: null,
        optionName: null,
      },
      {
        kind: "text",
        fieldId: "F_TEXT",
        name: "Notes",
        dataType: "TEXT",
        value: null,
      },
      {
        kind: "date",
        fieldId: "F_DATE",
        name: "Due",
        dataType: "DATE",
        value: "2026-02-03",
      },
      {
        kind: "number",
        fieldId: "F_NUMBER",
        name: "Estimate",
        dataType: "NUMBER",
        value: 1.25,
      },
      {
        kind: "unsupported",
        sourceType: "ProjectV2ItemFieldIterationValue",
      },
    ],
    pageInfo: { hasNextPage: true, endCursor: "FIELD_CURSOR" },
  });

  assert.equal(fake.calls.length, 2);
  assert.doesNotMatch(
    fake.calls[0].body.query,
    /fieldValues|labels\s*\(|\bbody\b/,
  );
  assert.equal(fake.calls[0].body.variables.itemId, ITEM_ID);
  assert.equal(fake.calls[1].body.variables.labelsFirst, 100);
  assert.equal(fake.calls[1].body.variables.labelsAfter, "LABEL_CURSOR");
  assert.equal(fake.calls[1].body.variables.fieldsFirst, 100);
  assert.equal(fake.calls[1].body.variables.fieldsAfter, "FIELDS_CURSOR");
});

test("single select and unsupported values preserve nullable option names", async () => {
  const fake = fakeFetch(
    dataResponse(itemAccessData()),
    dataResponse({
      node: detailNode({
        fieldValues: {
          nodes: [
            {
              __typename: "ProjectV2ItemFieldSingleSelectValue",
              name: "In progress",
              optionId: null,
              field: {
                id: "F_STATUS",
                name: "Status",
                dataType: "SINGLE_SELECT",
              },
            },
            {
              __typename: "ProjectV2ItemFieldIterationValue",
            },
          ],
          pageInfo: pageInfo(),
        },
      }),
    }),
  );

  const result = await getProjectItem({
    token: TEST_TOKEN,
    number: 7,
    itemId: ITEM_ID,
    first: 100,
    fetchImpl: fake.fetchImpl,
  });

  assert.deepEqual(result.item.fields.nodes[0], {
    kind: "singleSelect",
    fieldId: "F_STATUS",
    name: "Status",
    dataType: "SINGLE_SELECT",
    optionId: null,
    optionName: "In progress",
  });
  assert.deepEqual(result.item.fields.nodes[1], {
    kind: "unsupported",
    sourceType: "ProjectV2ItemFieldIterationValue",
  });
});

test("malformed or inconsistent field values become 502 rather than unsupported", async () => {
  for (const fieldValue of [
    {
      __typename: "ProjectV2ItemFieldTextValue",
      text: "value",
      field: { id: "F", name: "Mismatch", dataType: "DATE" },
    },
    {
      __typename: "ProjectV2ItemFieldTextValue",
      field: { id: "F", name: "Missing value", dataType: "TEXT" },
    },
    {
      __typename: "ProjectV2ItemFieldNumberValue",
      field: { id: "F", name: "Missing", dataType: "NUMBER" },
      text: "extra",
    },
    {
      __typename: "ProjectV2ItemFieldSingleSelectValue",
      name: null,
      optionId: null,
      field: { id: "F", name: "Status", dataType: "TEXT" },
    },
    { __typename: "" },
  ]) {
    const fake = fakeFetch(
      dataResponse(itemAccessData()),
      dataResponse({
        node: detailNode({
          fieldValues: { nodes: [fieldValue], pageInfo: pageInfo() },
        }),
      }),
    );
    await expectGitHubError(
      getProjectItem({
        token: TEST_TOKEN,
        number: 7,
        itemId: ITEM_ID,
        first: 100,
        fetchImpl: fake.fetchImpl,
      }),
      "github_unavailable",
      502,
    );
    assert.equal(fake.calls.length, 2);
  }
});

test("item detail accepts null labels and empty labels distinctly", async () => {
  for (const [content, expected] of [
    [issueContent({ labels: null }), null],
    [
      issueContent({ labels: labels([], pageInfo()) }),
      { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
    ],
  ]) {
    const fake = fakeFetch(
      dataResponse(itemAccessData()),
      dataResponse({ node: detailNode({ content }) }),
    );
    const result = await getProjectItem({
      token: TEST_TOKEN,
      number: 7,
      itemId: ITEM_ID,
      first: 100,
      fetchImpl: fake.fetchImpl,
    });
    assert.deepEqual(result.item.content.labels, expected);
  }
});

test("item detail rejects null field and label nodes", async () => {
  for (const overrides of [
    {
      content: issueContent({ labels: labels([null]) }),
    },
    {
      fieldValues: { nodes: [null], pageInfo: pageInfo() },
    },
  ]) {
    const fake = fakeFetch(
      dataResponse(itemAccessData()),
      dataResponse({ node: detailNode(overrides) }),
    );
    await expectGitHubError(
      getProjectItem({
        token: TEST_TOKEN,
        number: 7,
        itemId: ITEM_ID,
        first: 100,
        fetchImpl: fake.fetchImpl,
      }),
      "github_unavailable",
      502,
    );
    assert.equal(fake.calls.length, 2);
  }
});

test("item detail rejects content/type inconsistencies", async () => {
  for (const taskOverrides of [
    { type: "REDACTED", content: issueContent() },
    { type: "ISSUE", content: pullRequestContent() },
    { type: "PULL_REQUEST", content: draftIssueContent() },
    { type: "DRAFT_ISSUE", content: issueContent() },
    { type: "ISSUE", content: { __typename: "UnknownContent" } },
    { type: "UNKNOWN", content: null },
  ]) {
    const fake = fakeFetch(
      dataResponse(itemAccessData()),
      dataResponse({ node: detailNode(taskOverrides) }),
    );
    await expectGitHubError(
      getProjectItem({
        token: TEST_TOKEN,
        number: 7,
        itemId: ITEM_ID,
        first: 100,
        fetchImpl: fake.fetchImpl,
      }),
      "github_unavailable",
      502,
    );
  }
});

test("item detail rejects a missing ProjectV2Item discriminator", async () => {
  const node = detailNode();
  delete node.__typename;
  const fake = fakeFetch(
    dataResponse(itemAccessData()),
    dataResponse({ node }),
  );
  await expectGitHubError(
    getProjectItem({
      token: TEST_TOKEN,
      number: 7,
      itemId: ITEM_ID,
      first: 100,
      fetchImpl: fake.fetchImpl,
    }),
    "github_unavailable",
    502,
  );
});

test("item detail denies access before fetching project content", async () => {
  const deniedCases = [
    itemAccessData({ project: null }),
    itemAccessData({
      project: { ...projectMetadata(), owner: owner("O_ORG", "Organization") },
    }),
    itemAccessData({
      project: { ...projectMetadata(), owner: owner("U_OTHER") },
    }),
    itemAccessData({ node: null }),
    itemAccessData({ node: { __typename: "Issue" } }),
    itemAccessData({
      node: {
        __typename: "ProjectV2Item",
        id: "PVTI_OTHER",
        project: { id: PROJECT_ID },
      },
    }),
    itemAccessData({
      node: {
        __typename: "ProjectV2Item",
        id: ITEM_ID,
        project: { id: "PVT_OTHER" },
      },
    }),
  ];

  for (const data of deniedCases) {
    const fake = fakeFetch(dataResponse(data));
    await expectGitHubError(
      getProjectItem({
        token: TEST_TOKEN,
        number: 7,
        itemId: ITEM_ID,
        first: 100,
        fetchImpl: fake.fetchImpl,
      }),
      "not_found",
      404,
    );
    assert.equal(fake.calls.length, 1);
    assert.match(fake.calls[0].body.query, /ProjectItemAccess/);
    assert.doesNotMatch(
      fake.calls[0].body.query,
      /fieldValues|labels\s*\(|\bbody\b/,
    );
  }
});

test("item detail rejects access responses that are malformed or denied upstream", async () => {
  const malformed = fakeFetch(dataResponse({ viewer: { id: VIEWER_ID } }));
  await expectGitHubError(
    getProjectItem({
      token: TEST_TOKEN,
      number: 7,
      itemId: ITEM_ID,
      first: 100,
      fetchImpl: malformed.fetchImpl,
    }),
    "github_unavailable",
    502,
  );
  assert.equal(malformed.calls.length, 1);

  const forbidden = fakeFetch(
    jsonResponse({ errors: [{ type: "FORBIDDEN", message: "private" }] }),
  );
  await expectGitHubError(
    getProjectItem({
      token: TEST_TOKEN,
      number: 7,
      itemId: ITEM_ID,
      first: 100,
      fetchImpl: forbidden.fetchImpl,
    }),
    "github_reauth_required",
    403,
  );
  assert.equal(forbidden.calls.length, 1);
});

test("item detail rechecks project and owner after the proof query", async () => {
  const driftCases = [
    detailNode({ project: { id: "PVT_OTHER", owner: owner() } }),
    detailNode({ project: { id: PROJECT_ID, owner: owner("U_OTHER") } }),
    detailNode({
      project: { id: PROJECT_ID, owner: owner("O_ORG", "Organization") },
    }),
    null,
    { __typename: "Issue" },
  ];

  for (const node of driftCases) {
    const fake = fakeFetch(
      dataResponse(itemAccessData()),
      dataResponse({ node }),
    );
    await expectGitHubError(
      getProjectItem({
        token: TEST_TOKEN,
        number: 7,
        itemId: ITEM_ID,
        first: 100,
        fetchImpl: fake.fetchImpl,
      }),
      "not_found",
      404,
    );
    assert.equal(fake.calls.length, 2);
  }
});

test("token selection handles missing, ambiguous, encrypted, and malformed rows", () => {
  for (const rows of [
    [],
    [{ accessToken: null }],
    [{ accessToken: "" }],
    [{ accessToken: "$ba$ciphertext" }],
    [{ accessToken: "deadbeef" }],
    [{ accessToken: "0123456789abcdef0123456789abcdef01234567" }],
  ]) {
    expectSyncGitHubError(
      () => selectGitHubAccessToken(rows),
      "github_reauth_required",
    );
  }

  expectSyncGitHubError(
    () =>
      selectGitHubAccessToken([
        { accessToken: TEST_TOKEN },
        { accessToken: null },
      ]),
    "ambiguous_github_account",
  );
  expectSyncGitHubError(
    () =>
      selectGitHubAccessToken([
        { accessToken: TEST_TOKEN },
        { accessToken: "gho_other" },
      ]),
    "ambiguous_github_account",
  );

  for (const rows of [null, {}, "row", [{ accessToken: 5 }]]) {
    expectSyncGitHubError(
      () => selectGitHubAccessToken(rows),
      "internal_error",
    );
  }

  assert.equal(
    selectGitHubAccessToken([{ accessToken: TEST_TOKEN }]),
    TEST_TOKEN,
  );
});

test("HTTP, rate limit, timeout, and GraphQL errors map to safe local errors", async () => {
  const run = (response, options = {}) => {
    const fake = fakeFetch(response);
    return listProjects({
      token: TEST_TOKEN,
      first: 20,
      fetchImpl: fake.fetchImpl,
      ...options,
    });
  };

  let error = await expectGitHubError(
    run(
      new Response(null, { status: 429, headers: { "retry-after": "99999" } }),
    ),
    "rate_limited",
    429,
  );
  assert.equal(error.retryAfter, 3600);
  assert.equal(toErrorResponse(error).headers.get("retry-after"), "3600");

  error = await expectGitHubError(
    run(new Response(null, { status: 429 })),
    "rate_limited",
    429,
  );
  assert.equal(toErrorResponse(error).headers.get("retry-after"), "60");

  error = await expectGitHubError(
    run(
      new Response(null, { status: 429, headers: { "retry-after": "soon" } }),
    ),
    "rate_limited",
    429,
  );
  assert.equal(error.retryAfter, 60);

  error = await expectGitHubError(
    run(
      jsonResponse({
        errors: [{ type: "RATE_LIMITED", message: "upstream secret" }],
        data: {},
      }),
    ),
    "rate_limited",
    429,
  );
  assert.equal(error.retryAfter, 60);
  assert.equal(JSON.stringify(error).includes("upstream secret"), false);

  error = await expectGitHubError(
    run(jsonResponse({ errors: [{ extensions: { code: "RATE_LIMITED" } }] })),
    "rate_limited",
    429,
  );
  assert.equal(error.retryAfter, 60);

  error = await expectGitHubError(
    run(
      new Response(null, {
        status: 429,
        headers: {
          "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 7_200),
        },
      }),
    ),
    "rate_limited",
    429,
  );
  assert.equal(error.retryAfter, 3600);

  await expectGitHubError(
    run(jsonResponse({ errors: [{ type: "NOT_FOUND" }] })),
    "not_found",
    404,
  );
  for (const graphqlError of [
    { type: "FORBIDDEN" },
    { type: "INSUFFICIENT_SCOPES" },
    { type: "FORBIDDEN", extensions: { code: "INSUFFICIENT_SCOPES" } },
  ]) {
    await expectGitHubError(
      run(jsonResponse({ errors: [graphqlError] })),
      "github_reauth_required",
      403,
    );
  }
  await expectGitHubError(
    run(
      jsonResponse({ errors: [{ type: "SOMETHING", message: "sensitive" }] }),
    ),
    "github_unavailable",
    502,
  );
  await expectGitHubError(
    run(new Response(null, { status: 401 })),
    "github_reauth_required",
    403,
  );
  await expectGitHubError(
    run(new Response(null, { status: 403 })),
    "github_reauth_required",
    403,
  );
  await expectGitHubError(
    run(new Response(null, { status: 404 })),
    "not_found",
    404,
  );
  await expectGitHubError(
    run(new Response(null, { status: 400 })),
    "github_unavailable",
    502,
  );
  await expectGitHubError(
    run(new Response(null, { status: 500 })),
    "github_unavailable",
    502,
  );
  await expectGitHubError(
    run(new Response("{", { status: 200 })),
    "github_unavailable",
    502,
  );
  await expectGitHubError(
    run(jsonResponse({ data: null, errors: "bad" })),
    "github_unavailable",
    502,
  );
  await expectGitHubError(
    run(jsonResponse({ data: { viewer: { id: VIEWER_ID } } })),
    "github_unavailable",
    502,
  );
  await expectGitHubError(
    run(() => {
      throw new Error("network secret");
    }),
    "github_unavailable",
    502,
  );

  const timeout = fakeFetch(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      }),
  );
  await expectGitHubError(
    listProjects({
      token: TEST_TOKEN,
      first: 20,
      fetchImpl: timeout.fetchImpl,
      timeoutMs: 10,
    }),
    "github_unavailable",
    502,
  );
});

test("rate-limited HTTP 403 responses do not require reauthentication", async () => {
  for (const [headers, expectedRetry] of [
    [{ "retry-after": "120" }, 120],
    [{ "retry-after": "invalid" }, 60],
    [{ "x-ratelimit-remaining": "0" }, 60],
    [
      {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 7200),
      },
      3600,
    ],
  ]) {
    const fake = fakeFetch(new Response(null, { status: 403, headers }));
    const error = await expectGitHubError(
      listProjects({ token: TEST_TOKEN, first: 20, fetchImpl: fake.fetchImpl }),
      "rate_limited",
      429,
    );
    assert.equal(error.retryAfter, expectedRetry);
    assert.equal(
      toErrorResponse(error).headers.get("retry-after"),
      String(expectedRetry),
    );
  }
});

test("error responses cover all supported statuses with safe headers and bodies", async () => {
  const cases = [
    ["invalid_request", 400],
    ["unauthenticated", 401],
    ["github_reauth_required", 403],
    ["forbidden", 403],
    ["ambiguous_github_account", 403],
    ["not_found", 404],
    ["rate_limited", 429],
    ["internal_error", 500],
    ["github_unavailable", 502],
  ];

  for (const [code, status] of cases) {
    const response = toErrorResponse(new GitHubApiError(code));
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-type"), /application\/json/);
    const body = await response.json();
    assert.equal(body.error.code, code);
    assert.equal(typeof body.error.message, "string");
    assert.equal("stack" in body.error, false);
    if (code === "rate_limited") {
      assert.match(response.headers.get("retry-after"), /^[0-9]+$/);
    } else {
      assert.equal(response.headers.get("retry-after"), null);
    }
  }

  const unknown = toErrorResponse(new Error("token=ultra-secret"));
  assert.equal(unknown.status, 500);
  const unknownBody = await unknown.text();
  assert.equal(unknownBody.includes("ultra-secret"), false);
  assert.equal(unknownBody.includes("internal_error"), true);
  assert.equal(unknown.headers.get("cache-control"), "no-store");
});

test("routes authenticate first and validate before token access", async () => {
  const unauthenticatedListContext = routeContext({ query: { first: "0" } });
  const unauthenticatedList = await listProjectsRoute(
    unauthenticatedListContext,
  );
  assert.equal(unauthenticatedList.status, 401);
  assert.equal(unauthenticatedList.headers.get("cache-control"), "no-store");
  assert.equal(
    (await unauthenticatedList.json()).error.code,
    "unauthenticated",
  );

  const authenticatedInvalidListContext = routeContext({
    query: { first: "0" },
  });
  const authenticatedInvalidList = await authContext.run(
    { user: { id: VIEWER_ID }, state: null },
    () => listProjectsRoute(authenticatedInvalidListContext),
  );
  assert.equal(authenticatedInvalidList.status, 400);
  assert.equal(
    (await authenticatedInvalidList.json()).error.code,
    "invalid_request",
  );

  const unauthenticatedItemsContext = routeContext({ params: { number: "0" } });
  const unauthenticatedItems = await listItemsRoute(
    unauthenticatedItemsContext,
  );
  assert.equal(unauthenticatedItems.status, 401);
  assert.equal(unauthenticatedItems.headers.get("cache-control"), "no-store");

  const authenticatedInvalidItemsContext = routeContext({
    params: { number: "0" },
  });
  const authenticatedInvalidItems = await authContext.run(
    { user: { id: VIEWER_ID }, state: null },
    () => listItemsRoute(authenticatedInvalidItemsContext),
  );
  assert.equal(authenticatedInvalidItems.status, 400);
  assert.equal(
    (await authenticatedInvalidItems.json()).error.code,
    "invalid_request",
  );

  const authenticatedInvalidItemContext = routeContext({
    params: { number: "7", itemId: "bad\u0000id" },
  });
  const authenticatedInvalidItem = await authContext.run(
    { user: { id: VIEWER_ID }, state: null },
    () => itemDetailRoute(authenticatedInvalidItemContext),
  );
  assert.equal(authenticatedInvalidItem.status, 400);
  assert.equal(
    (await authenticatedInvalidItem.json()).error.code,
    "invalid_request",
  );
});

test("RPC routes transform inputs, preserve pagination and encode opaque IDs", async () => {
  const id = "item/%?#日本";
  const upstream = fakeFetch(
    dataResponse(
      projectsData([projectListItem()], { pageInfo: pageInfo(true, "next") }),
    ),
    dataResponse(projectItemsData([task()])),
    dataResponse(
      itemAccessData({
        node: { __typename: "ProjectV2Item", id, project: { id: PROJECT_ID } },
      }),
    ),
    dataResponse({ node: detailNode({ id }) }),
    dataResponse(projectsData([])),
  );
  const originalFetch = globalThis.fetch;
  const users = [];
  globalThis.fetch = upstream.fetchImpl;
  try {
    const app = createProjectApp(async (userId) => {
      users.push(userId);
      return TEST_TOKEN;
    });
    const urls = [];
    const client = createProjectsClient("", (url, init) => {
      urls.push(String(url));
      return app.fetch(
        new Request(new URL(String(url), "http://localhost"), init),
      );
    });
    await authContext.run(
      { user: { id: VIEWER_ID }, state: null },
      async () => {
        const projects = await client.api.projects.$get({
          query: { after: "cursor" },
        });
        assert.equal(projects.status, 200);
        assert.equal(projects.headers.get("cache-control"), "no-store");
        assert.equal((await projects.json()).pageInfo.endCursor, "next");
        const items = await client.api.projects[":number"].items.$get({
          param: { number: "007" },
          query: { first: "03", archived: "1", after: "more" },
        });
        assert.equal(items.status, 200);
        assert.equal(items.headers.get("cache-control"), "no-store");
        assert.equal((await items.json()).items.length, 1);
        const detail = await client.api.projects[":number"].items[
          ":itemId"
        ].$get({
          param: { number: "7", itemId: encodeProjectPathSegment(id) },
          query: { labelsAfter: "label", fieldsAfter: "field" },
        });
        assert.equal(detail.status, 200);
        assert.equal(detail.headers.get("cache-control"), "no-store");
        assert.equal((await detail.json()).item.id, id);
        const invalid = await app.request("/api/projects?first=20&first=101");
        assert.equal(invalid.status, 400);
        const valid = await app.request("/api/projects?first=101&first=20");
        assert.equal(valid.status, 200);
      },
    );
    assert.equal(urls.length, 3);
    assert.equal(urls[0], "/api/projects?after=cursor");
    assert.ok(urls[2].includes(encodeProjectPathSegment(id)));
    assert.deepEqual(upstream.calls[0].body.variables, {
      first: 20,
      after: "cursor",
    });
    assert.deepEqual(upstream.calls[1].body.variables, {
      number: 7,
      first: 3,
      after: "more",
      archivedStates: ["ARCHIVED", "NOT_ARCHIVED"],
      labelsFirst: 100,
      labelsAfter: null,
      fieldsFirst: 100,
      fieldsAfter: null,
    });
    assert.deepEqual(upstream.calls[2].body.variables, {
      number: 7,
      itemId: id,
    });
    assert.deepEqual(upstream.calls[3].body.variables, {
      itemId: id,
      labelsFirst: 100,
      labelsAfter: "label",
      fieldsFirst: 100,
      fieldsAfter: "field",
    });
    assert.equal(upstream.calls[4].body.variables.first, 20);
    assert.deepEqual(users, [VIEWER_ID, VIEWER_ID, VIEWER_ID, VIEWER_ID]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("adapters forward raw request, environment and optional execution context", async () => {
  const captured = [];
  const spy = mock.method(projectApp, "fetch", async (...args) => {
    captured.push(args);
    return new Response(null, { status: 204 });
  });
  try {
    for (const [adapter, path] of [
      [listProjectsRoute, "/api/projects?first=3"],
      [listItemsRoute, "/api/projects/7/items?first=4"],
      [itemDetailRoute, "/api/projects/7/items/x%2Fy?first=5"],
    ]) {
      const raw = new Request(`http://localhost${path}`);
      const env = { marker: path };
      const executionCtx = { waitUntil() {}, passThroughOnException() {} };
      await adapter({ req: { raw }, env, executionCtx });
      await adapter({
        req: { raw },
        env,
        get executionCtx() {
          throw new Error("no context");
        },
      });
      assert.deepEqual(captured.splice(0), [
        [raw, env, executionCtx],
        [raw, env, undefined],
      ]);
    }
  } finally {
    spy.mock.restore();
  }
});

test("hc does not retry an unsuccessful response", async () => {
  let calls = 0;
  const client = createProjectsClient("", async () => {
    calls++;
    return Response.json(
      { error: { code: "internal_error", message: "error" } },
      { status: 500 },
    );
  });
  assert.equal((await client.api.projects.$get({ query: {} })).status, 500);
  assert.equal(calls, 1);
});

test("Hono dispatch matches original Void route method and slash behavior", async () => {
  const baseline = new Hono();
  for (const path of [
    "/api/projects",
    "/api/projects/:number/items",
    "/api/projects/:number/items/:itemId",
  ]) {
    baseline.get(path, () =>
      toErrorResponse(new GitHubApiError("unauthenticated")),
    );
  }
  for (const [method, path] of [
    ["GET", "/api/projects"],
    ["HEAD", "/api/projects"],
    ["POST", "/api/projects"],
    ["GET", "/api/projects/"],
    ["GET", "/api/projects/7/items/"],
    ["GET", "/api/projects/unknown/path"],
  ]) {
    const original = await baseline.request(path, { method });
    const current = await projectApp.request(path, { method });
    assert.equal(current.status, original.status, `${method} ${path}`);
    assert.equal(
      await current.text(),
      await original.text(),
      `${method} ${path} body`,
    );
  }
});

test("RPC errors are sanitized and validation precedes token lookup", async () => {
  let calls = 0;
  let failure = new GitHubApiError("rate_limited", 123);
  const app = createProjectApp(async () => {
    calls++;
    throw failure;
  });
  const anonymous = await app.request("/api/projects?first=0");
  assert.equal(anonymous.status, 401);
  await authContext.run({ user: { id: VIEWER_ID }, state: null }, async () => {
    assert.equal((await app.request("/api/projects?first=0")).status, 400);
    assert.equal(calls, 0);
    const limited = await app.request("/api/projects");
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "123");
    assert.equal(limited.headers.get("cache-control"), "no-store");
    assert.equal((await limited.json()).error.code, "rate_limited");
    failure = new Error("sensitive detail");
    const unknown = await app.request("/api/projects");
    assert.equal(unknown.status, 500);
    assert.equal(unknown.headers.get("cache-control"), "no-store");
    assert.equal((await unknown.json()).error.code, "internal_error");
  });
  assert.equal(calls, 2);
});
