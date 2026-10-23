import * as v from "valibot";
import { boundRetryAfter, GitHubApiError } from "./errors.ts";
import { graphqlEnvelopeSchema, type GraphQLError } from "./schemas.ts";

const GITHUB_GRAPHQL_ENDPOINT = "https://api.github.com/graphql";
const DEFAULT_TIMEOUT_MS = 8_000;
export type FetchLike = typeof fetch;

export async function githubGraphQL<const TSchema extends v.GenericSchema>(options: {
  token: string;
  query: string;
  variables: Record<string, unknown>;
  schema: TSchema;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<v.InferOutput<TSchema>> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetchImpl(GITHUB_GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "gh-projects-viewer-pwa/1.0",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          query: options.query,
          variables: options.variables,
        }),
        signal: controller.signal,
      });
    } catch {
      throw new GitHubApiError("github_unavailable");
    }

    if (timedOut) {
      throw new GitHubApiError("github_unavailable");
    }

    const retryAfter = readRetryAfter(response);
    if (
      response.status === 429 ||
      (response.status === 403 &&
        (response.headers.has("retry-after") ||
          response.headers.get("x-ratelimit-remaining") === "0"))
    ) {
      throw new GitHubApiError("rate_limited", retryAfter);
    }
    if (response.status === 401 || response.status === 403) {
      throw new GitHubApiError("github_reauth_required");
    }
    if (response.status === 404) {
      throw new GitHubApiError("not_found");
    }
    if (!response.ok) {
      throw new GitHubApiError("github_unavailable");
    }

    let body: unknown;
    try {
      body = JSON.parse(await response.text());
    } catch {
      throw new GitHubApiError("github_unavailable");
    }

    if (timedOut) {
      throw new GitHubApiError("github_unavailable");
    }

    const envelope = v.safeParse(graphqlEnvelopeSchema, body);
    if (!envelope.success) {
      throw new GitHubApiError("github_unavailable");
    }

    const errors = envelope.output.errors ?? [];
    if (errors.length > 0) {
      if (errors.some(isRateLimitError)) {
        throw new GitHubApiError("rate_limited", retryAfter);
      }
      if (errors.some(isNotFoundError)) {
        throw new GitHubApiError("not_found");
      }
      if (errors.some(isForbiddenError)) {
        throw new GitHubApiError("github_reauth_required");
      }
      throw new GitHubApiError("github_unavailable");
    }

    const data = v.safeParse(options.schema, envelope.output.data);
    if (!data.success) {
      throw new GitHubApiError("github_unavailable");
    }
    return data.output;
  } finally {
    clearTimeout(timeout);
  }
}

function isRateLimitError(error: GraphQLError): boolean {
  return error.type === "RATE_LIMITED" || error.extensions?.code === "RATE_LIMITED";
}

function isNotFoundError(error: GraphQLError): boolean {
  return error.type === "NOT_FOUND";
}

function isForbiddenError(error: GraphQLError): boolean {
  return (
    error.type === "FORBIDDEN" ||
    error.type === "INSUFFICIENT_SCOPES" ||
    error.extensions?.code === "INSUFFICIENT_SCOPES"
  );
}

function readRetryAfter(response: Response): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null && /^[0-9]{1,10}$/.test(retryAfter.trim())) {
    return boundRetryAfter(Number(retryAfter));
  }

  const reset = response.headers.get("x-ratelimit-reset");
  if (reset !== null && /^[0-9]{1,12}$/.test(reset.trim())) {
    const seconds = Math.ceil(Number(reset) - Date.now() / 1000);
    if (Number.isFinite(seconds) && seconds > 0) {
      return boundRetryAfter(seconds);
    }
  }

  return 60;
}
