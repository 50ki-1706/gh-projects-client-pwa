import { Hono, type MiddlewareHandler } from "hono";
import type { ApplyGlobalResponse } from "hono/client";
import { getUser } from "void/auth";
import * as v from "valibot";
import { errorDefinitions, GitHubApiError, toErrorResponse } from "./errors.ts";
import { listProjects, listProjectItems, getProjectItem } from "./projects.ts";
import { getGitHubAccessToken } from "./token.ts";
import {
  projectsQuerySchema,
  projectItemsQuerySchema,
  projectItemQuerySchema,
  projectParamsSchema,
  projectItemParamsSchema,
} from "./schemas.ts";

type ProjectEnv = { Variables: { userId: string } };

function validate<
  T extends "query" | "param",
  S extends v.GenericSchema<unknown, object>,
>(
  target: T,
  schema: S,
): MiddlewareHandler<
  ProjectEnv,
  string,
  { in: { [K in T]: v.InferInput<S> }; out: { [K in T]: v.InferOutput<S> } }
> {
  return async (c, next) => {
    const input =
      target === "query"
        ? Object.fromEntries(new URL(c.req.url).searchParams)
        : c.req.param();
    const result = v.safeParse(schema, input);
    if (!result.success) throw new GitHubApiError("invalid_request");
    c.req.addValidatedData(target, result.output);
    await next();
  };
}

const auth: MiddlewareHandler<ProjectEnv> = async (c, next) => {
  const user = getUser();
  if (user === null) throw new GitHubApiError("unauthenticated");
  c.set("userId", user.id);
  await next();
};

export function createProjectApp(getAccessToken = getGitHubAccessToken) {
  const app = new Hono<ProjectEnv>();
  app.onError(toErrorResponse);
  app.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });
  return app
    .get(
      "/api/projects",
      auth,
      validate("query", projectsQuerySchema),
      async (c) =>
        c.json(
          await listProjects({
            token: await getAccessToken(c.get("userId")),
            ...c.req.valid("query"),
          }),
          200,
        ),
    )
    .get(
      "/api/projects/:number/items",
      auth,
      validate("param", projectParamsSchema),
      validate("query", projectItemsQuerySchema),
      async (c) =>
        c.json(
          await listProjectItems({
            token: await getAccessToken(c.get("userId")),
            ...c.req.valid("param"),
            ...c.req.valid("query"),
          }),
          200,
        ),
    )
    .get(
      "/api/projects/:number/items/:itemId",
      auth,
      validate("param", projectItemParamsSchema),
      validate("query", projectItemQuerySchema),
      async (c) =>
        c.json(
          await getProjectItem({
            token: await getAccessToken(c.get("userId")),
            ...c.req.valid("param"),
            ...c.req.valid("query"),
          }),
          200,
        ),
    );
}

export const projectApp = createProjectApp();

type Definitions = typeof errorDefinitions;
type ErrorResponses = {
  [S in Definitions[keyof Definitions]["status"]]: {
    json: {
      [K in keyof Definitions]: Definitions[K]["status"] extends S
        ? { error: { code: K; message: string } }
        : never;
    }[keyof Definitions];
  };
};
export type ProjectApi = ApplyGlobalResponse<typeof projectApp, ErrorResponses>;
