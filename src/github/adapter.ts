import type { CloudContext } from "void";
import { projectApp } from "./rpc.ts";

export function projectAdapter(c: CloudContext) {
  let executionCtx: CloudContext["executionCtx"] | undefined;
  try {
    executionCtx = c.executionCtx;
  } catch {
    // Hono throws when a direct request has no execution context.
  }
  return projectApp.fetch(c.req.raw, c.env, executionCtx);
}
