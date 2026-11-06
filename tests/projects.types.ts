import { createProjectsClient } from "../src/client/projects-rpc.ts";
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
async function checkProjectRoutes() {
  const client = createProjectsClient();
  const projects = await client.api.projects.$get({ query: { first: "20" } });
  const items = await client.api.projects[":number"].items.$get({
    param: { number: "7" },
    query: { archived: "1" },
  });
  const item = await client.api.projects[":number"].items[":itemId"].$get({
    param: { number: "7", itemId: "id" },
    query: { fieldsAfter: "cursor" },
  });
  client.api.projects[":number"].items[":itemId"].$get({
    param: { number: "7", itemId: "item" },
    query: {},
  });
  if (projects.status === 200) {
    type T = Expect<
      Equal<Awaited<ReturnType<typeof projects.json>>, ProjectsResponse>
    >;
  }
  if (projects.status === 401) {
    type Unauthorized = Expect<
      Equal<
        Awaited<ReturnType<typeof projects.json>>["error"]["code"],
        "unauthenticated"
      >
    >;
  }
  if (projects.status === 403) {
    type Forbidden = Expect<
      Equal<
        Awaited<ReturnType<typeof projects.json>>["error"]["code"],
        "github_reauth_required" | "forbidden" | "ambiguous_github_account"
      >
    >;
  }
  if (items.status === 200) {
    type T = Expect<
      Equal<Awaited<ReturnType<typeof items.json>>, ProjectItemsResponse>
    >;
  }
  if (item.status === 200) {
    type T = Expect<
      Equal<Awaited<ReturnType<typeof item.json>>, ProjectItemResponse>
    >;
  }
  // @ts-expect-error wire query values are strings
  client.api.projects.$get({ query: { first: 20 } });
  client.api.projects[":number"].items.$get({
    param: { number: "7" },
    // @ts-expect-error archived is a picklist
    query: { archived: "true" },
  });
  // @ts-expect-error unknown query
  client.api.projects.$get({ query: { owner: "x" } });
  client.api.projects[":number"].items[":itemId"].$get({
    // @ts-expect-error missing itemId
    param: { number: "7" },
  });
}
