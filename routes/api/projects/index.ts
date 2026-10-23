import { defineGitHubHandler } from "../../../src/github/handler.ts";
import { projectOperations } from "../../../src/github/operations.ts";
import { listProjects } from "../../../src/github/projects.ts";

export const GET = defineGitHubHandler(
  projectOperations.listProjects,
  (token, { query }) => listProjects({ token, ...query }),
);
