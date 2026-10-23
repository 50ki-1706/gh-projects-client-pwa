import { defineGitHubHandler } from "../../../../../src/github/handler.ts";
import { projectOperations } from "../../../../../src/github/operations.ts";
import { getProjectItem } from "../../../../../src/github/projects.ts";

export const GET = defineGitHubHandler(
  projectOperations.getProjectItem,
  (token, { params, query }) => getProjectItem({ token, ...params, ...query }),
);
