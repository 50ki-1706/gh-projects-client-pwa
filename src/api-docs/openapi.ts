import { toJsonSchema, type JsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import { errorDefinitions, type GitHubApiErrorCode } from "../github/errors.ts";
import {
  projectOperations,
  type ProjectOperation,
} from "../github/operations.ts";

const OPENAPI_VERSION = "3.1.0";
const JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";
const NO_STORE_HEADER = "NoStore";
const RETRY_AFTER_HEADER = "RetryAfter";

const EMITTED_ERROR_CODES = [
  "invalid_request",
  "unauthenticated",
  "github_reauth_required",
  "ambiguous_github_account",
  "not_found",
  "rate_limited",
  "internal_error",
  "github_unavailable",
] as const satisfies readonly GitHubApiErrorCode[];

type OpenApiParameter = {
  name: string;
  in: "path" | "query";
  required: boolean;
  description?: string;
  schema: JsonSchema;
};

type OpenApiDocument = {
  openapi: "3.1.0";
  jsonSchemaDialect: string;
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers: Array<{ url: string; description: string }>;
  tags: Array<{ name: string; description: string }>;
  security: Array<Record<string, string[]>>;
  paths: Record<string, { get: Record<string, unknown> }>;
  components: {
    schemas: Record<string, JsonSchema>;
    securitySchemes: Record<string, Record<string, unknown>>;
    headers: Record<string, Record<string, unknown>>;
  };
};

const GENERAL_DESCRIPTION = [
  "ログイン中の GitHub ユーザーが個人所有する GitHub Projects（ProjectV2）を読み取る API です。読み取り専用で、GitHub への書き込みは行いません。",
  [
    "- 認証: Better Auth のセッション Cookie が必要です。未ログインは `401 unauthenticated` です。",
    "- 対象: 個人（User）所有のプロジェクトのみです。Organization 所有のプロジェクトは一覧に含めず、番号指定では `404` になります。",
    "- 権限: GitHub OAuth では、この API のために追加するスコープは `read:project` だけです。既存の認証で使われる GitHub の既定スコープは変更しません。`repo` / `write:*` / `project` は追加しません。プライベートリポジトリの本文などは GitHub 側で redact されることがあります。",
    "- 上流: GitHub GraphQL API へのタイムアウトは8秒で、自動リトライは行いません。",
    "- ページネーション: GitHub が拒否した不明なカーソルは `502 github_unavailable` です。",
    "- エラー: 上流の HTTP 404 と GraphQL `NOT_FOUND` は `404 not_found` です。HTTP 429、`Retry-After` / `X-RateLimit-Remaining: 0` を伴う HTTP 403、GraphQL `RATE_LIMITED` は `429 rate_limited` です。上流の 401/403 と GraphQL `FORBIDDEN` / `INSUFFICIENT_SCOPES` は `403 github_reauth_required` です。",
    "- レート制限の `Retry-After` は1〜3600秒に丸めます。上流の生メッセージ、GraphQL クエリ、アクセストークンは返しません。",
    "- キャッシュ: 成功・エラーとも `Cache-Control: no-store` を設定します。",
  ].join("\n"),
].join("\n\n");

function convert(
  schema: v.GenericSchema,
  typeMode: "input" | "output",
): JsonSchema {
  const jsonSchema = toJsonSchema(schema, {
    target: "draft-2020-12",
    typeMode,
    errorMode: "throw",
    // Arbitrary checks have no JSON Schema equivalent. Their constraints are
    // documented on the input and pageInfo schemas instead.
    ignoreActions: ["check"],
  });
  delete jsonSchema.$schema;
  return jsonSchema;
}

function errorComponentName(code: GitHubApiErrorCode): string {
  const suffix = code
    .split("_")
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join("");
  return `Error${suffix}`;
}

function buildErrorComponents(): Record<string, JsonSchema> {
  return Object.fromEntries(
    EMITTED_ERROR_CODES.map((code) => {
      const definition = errorDefinitions[code];
      const schema = convert(
        v.object({
          error: v.object({
            code: v.literal(code),
            message: v.literal(definition.message),
          }),
        }),
        "output",
      );
      schema.description = `${definition.status} ${code}: ${definition.message}`;
      return [errorComponentName(code), schema];
    }),
  );
}

function buildParameters(
  entries: Record<string, v.GenericSchema> | undefined,
  location: "path" | "query",
): OpenApiParameter[] {
  if (entries === undefined) return [];

  return Object.entries(entries).map(([name, schema]) => {
    const jsonSchema = convert(schema, "input");
    const description = jsonSchema.description;
    delete jsonSchema.description;

    return {
      name,
      in: location,
      required: location === "path" || schema.type !== "optional",
      ...(description === undefined ? {} : { description }),
      schema: jsonSchema,
    };
  });
}

function buildSuccessResponse(name: string) {
  return {
    description: "成功。`Cache-Control: no-store` を返します。",
    headers: {
      "Cache-Control": { $ref: `#/components/headers/${NO_STORE_HEADER}` },
    },
    content: {
      "application/json": {
        schema: { $ref: `#/components/schemas/${name}` },
      },
    },
  };
}

function buildErrorResponses(): Record<string, unknown> {
  const codesByStatus = new Map<number, GitHubApiErrorCode[]>();

  for (const code of EMITTED_ERROR_CODES) {
    const status = errorDefinitions[code].status;
    const codes = codesByStatus.get(status) ?? [];
    codes.push(code);
    codesByStatus.set(status, codes);
  }

  return Object.fromEntries(
    [...codesByStatus].map(([status, codes]) => {
      const schemas = codes.map((code) => ({
        $ref: `#/components/schemas/${errorComponentName(code)}`,
      }));
      const headers: Record<string, unknown> = {
        "Cache-Control": { $ref: `#/components/headers/${NO_STORE_HEADER}` },
      };
      if (status === errorDefinitions.rate_limited.status) {
        headers["Retry-After"] = {
          $ref: `#/components/headers/${RETRY_AFTER_HEADER}`,
        };
      }

      return [
        String(status),
        {
          description: codes
            .map((code) => `${code}: ${errorDefinitions[code].message}`)
            .join("\n"),
          headers,
          content: {
            "application/json": {
              schema: codes.length === 1 ? schemas[0] : { oneOf: schemas },
            },
          },
        },
      ];
    }),
  );
}

export function buildOpenApiDocument(): OpenApiDocument {
  const operations: Record<string, ProjectOperation> = projectOperations;
  const errorResponses = buildErrorResponses();
  const responseComponents = Object.fromEntries(
    Object.values(operations).map(({ response }) => [
      response.name,
      {
        ...convert(response.schema, "output"),
        description: response.description,
      },
    ]),
  );

  const paths = Object.fromEntries(
    Object.entries(operations).map(([operationId, operation]) => [
      operation.path,
      {
        get: {
          tags: ["Projects"],
          operationId,
          summary: operation.summary,
          description: operation.description,
          parameters: [
            ...buildParameters(operation.validators.params?.entries, "path"),
            ...buildParameters(operation.validators.query.entries, "query"),
          ],
          responses: {
            "200": buildSuccessResponse(operation.response.name),
            ...errorResponses,
          },
        },
      },
    ]),
  );

  return {
    openapi: OPENAPI_VERSION,
    jsonSchemaDialect: JSON_SCHEMA_DIALECT,
    info: {
      title: "GitHub Projects 読み取り API",
      version: "1.0.0",
      description: GENERAL_DESCRIPTION,
    },
    servers: [{ url: "/", description: "同一オリジン" }],
    tags: [
      {
        name: "Projects",
        description: "個人所有の GitHub Projects（ProjectV2）の読み取り。",
      },
    ],
    security: [{ sessionCookie: [] }],
    paths,
    components: {
      schemas: {
        ...responseComponents,
        ...buildErrorComponents(),
      },
      securitySchemes: {
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "better-auth.session_token",
          description:
            "Better Auth のセッション Cookie。HTTPS では `__Secure-better-auth.session_token`、HTTP では `better-auth.session_token` です。GitHub のアクセストークンを直接受け取る方式ではありません。",
        },
      },
      headers: {
        [NO_STORE_HEADER]: {
          description:
            "すべての API レスポンスをキャッシュしないことを示します。",
          schema: { type: "string", const: "no-store" },
        },
        [RETRY_AFTER_HEADER]: {
          description: "再試行までの秒数（1〜3600）。",
          schema: { type: "integer", minimum: 1, maximum: 3600 },
        },
      },
    },
  };
}

let cachedDocument: OpenApiDocument | undefined;

export function getOpenApiDocument(): OpenApiDocument {
  cachedDocument ??= buildOpenApiDocument();
  return cachedDocument;
}
