import { fetch } from "void/client";
import { defineGitHubHandler } from "../src/github/handler.ts";
import { projectOperations } from "../src/github/operations.ts";
import type {
  ProjectItemResponse,
  ProjectItemsResponse,
  ProjectsResponse,
} from "../src/github/schemas.ts";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

function checkResponseContract() {
  defineGitHubHandler(
    projectOperations.listProjects,
    // @ts-expect-error Handler output must match the documented response schema.
    async () => ({
      projects: [],
      pageInfo: { hasNextPage: false, endCursor: null },
      totalCount: "0",
    }),
  );
}

// Compile only: verify Void's generated client types through the auth wrapper.
async function checkProjectRoutes() {
  const projects = await fetch("/api/projects", { query: { first: "20" } });
  const items = await fetch("/api/projects/:number/items", {
    params: { number: "7" },
    query: { archived: "1" },
  });
  const item = await fetch("/api/projects/:number/items/:itemId", {
    params: { number: "7", itemId: "PVTI_ITEM" },
    query: { fieldsAfter: "cursor" },
  });

  type Projects = Expect<Equal<typeof projects, ProjectsResponse>>;
  type Items = Expect<Equal<typeof items, ProjectItemsResponse>>;
  type Item = Expect<Equal<typeof item, ProjectItemResponse>>;

  // @ts-expect-error Query inputs are strings before Valibot transforms them.
  await fetch("/api/projects", { query: { first: 20 } });
  await fetch("/api/projects/:number/items", {
    params: { number: "7" },
    // @ts-expect-error The validator accepts only "0" or "1" for archived.
    query: { archived: "true" },
  });
  // @ts-expect-error Unknown query parameters are not part of the client API.
  await fetch("/api/projects", { query: { owner: "other-user" } });
  await fetch("/api/projects/:number/items/:itemId", {
    // @ts-expect-error Both path parameters are required.
    params: { number: "7" },
  });
}
