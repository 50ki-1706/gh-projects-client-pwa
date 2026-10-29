import { defineGitHubHandler } from "../../../../src/github/handler.ts";
import { projectOperations } from "../../../../src/github/operations.ts";
import { listProjectItems } from "../../../../src/github/projects.ts";

export const GET = defineGitHubHandler(
  projectOperations.listProjectItems,
  (token, { params, query }) =>
    listProjectItems({ token, ...params, ...query }),
);
