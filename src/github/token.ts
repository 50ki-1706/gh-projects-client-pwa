import * as v from "valibot";
import { db, sql } from "void/db";
import { GitHubApiError } from "./errors.ts";
import { githubTokenRowsSchema } from "./schemas.ts";

const GITHUB_PROVIDER_ID = "github";

export async function getGitHubAccessToken(userId: string): Promise<string> {
  const rows: unknown = await db.all(
    sql`SELECT accessToken FROM account WHERE userId = ${userId} AND providerId = ${GITHUB_PROVIDER_ID} LIMIT 2`,
  );
  return selectGitHubAccessToken(rows);
}

export function selectGitHubAccessToken(rows: unknown): string {
  const parsed = v.safeParse(githubTokenRowsSchema, rows);
  if (!parsed.success) {
    throw new GitHubApiError("internal_error");
  }

  if (parsed.output.length > 1) {
    throw new GitHubApiError("ambiguous_github_account");
  }

  const token = parsed.output[0]?.accessToken;
  if (!token) {
    throw new GitHubApiError("github_reauth_required");
  }

  if (token.startsWith("$ba$") || /^(?:[0-9a-f]{2})+$/iu.test(token)) {
    throw new GitHubApiError("github_reauth_required");
  }

  return token;
}
