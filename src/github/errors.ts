const MAX_RETRY_AFTER_SECONDS = 3_600;

export const errorDefinitions = {
  invalid_request: {
    status: 400,
    message: "リクエストのパラメータが不正です。",
  },
  unauthenticated: {
    status: 401,
    message: "ログインが必要です。",
  },
  github_reauth_required: {
    status: 403,
    message: "GitHub の再認証が必要です。",
  },
  forbidden: {
    status: 403,
    message: "この操作は許可されていません。",
  },
  ambiguous_github_account: {
    status: 403,
    message: "GitHub アカウントの紐付けが複数あります。",
  },
  not_found: {
    status: 404,
    message: "プロジェクトまたは項目が見つかりません。",
  },
  rate_limited: {
    status: 429,
    message: "GitHub API のレート制限に達しました。",
  },
  internal_error: {
    status: 500,
    message: "サーバーエラーが発生しました。",
  },
  github_unavailable: {
    status: 502,
    message: "GitHub API を利用できません。",
  },
} as const;

export type GitHubApiErrorCode = keyof typeof errorDefinitions;

export class GitHubApiError extends Error {
  readonly code: GitHubApiErrorCode;
  readonly status: number;
  readonly retryAfter: number | undefined;

  constructor(code: GitHubApiErrorCode, retryAfter?: number) {
    const definition = errorDefinitions[code];
    super(definition.message);
    this.name = "GitHubApiError";
    this.code = code;
    this.status = definition.status;
    this.retryAfter =
      retryAfter === undefined ? undefined : boundRetryAfter(retryAfter);
  }
}

export function toErrorResponse(error: unknown): Response {
  const apiError =
    error instanceof GitHubApiError
      ? error
      : new GitHubApiError("internal_error");
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
  };

  if (apiError.code === "rate_limited") {
    headers["Retry-After"] = String(apiError.retryAfter ?? 60);
  }

  return Response.json(
    {
      error: {
        code: apiError.code,
        message: apiError.message,
      },
    },
    {
      status: apiError.status,
      headers,
    },
  );
}

export function boundRetryAfter(seconds: number): number {
  const safe = Number.isFinite(seconds) ? Math.floor(seconds) : 60;
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, safe));
}
