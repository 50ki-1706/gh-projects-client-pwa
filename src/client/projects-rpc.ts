import { hc } from "hono/client";
import type { ProjectApi } from "../github/rpc.ts";

export function createProjectsClient(base = "", fetcher?: typeof fetch) {
  return hc<ProjectApi>(base, fetcher ? { fetch: fetcher } : undefined);
}

export function encodeProjectPathSegment(value: string): string {
  return encodeURIComponent(value);
}
