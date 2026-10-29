import type * as v from "valibot";
import {
  projectItemParamsSchema,
  projectItemQuerySchema,
  projectItemResponseSchema,
  projectItemsQuerySchema,
  projectItemsResponseSchema,
  projectParamsSchema,
  projectsQuerySchema,
  projectsResponseSchema,
} from "./schemas.ts";

export type ProjectOperation = {
  path: string;
  summary: string;
  description: string;
  validators: {
    params?: v.ObjectSchema<v.ObjectEntries, undefined>;
    query: v.ObjectSchema<v.ObjectEntries, undefined>;
  };
  response: {
    name: string;
    schema: v.GenericSchema;
    description: string;
  };
};

// Shared by the route handlers and OpenAPI generator. Void's validator types
// are phantom types, so documentation cannot discover them from a handler.
export const projectOperations = {
  listProjects: {
    path: "/api/projects",
    summary: "プロジェクト一覧を取得",
    description:
      "ログイン中のユーザーが個人所有するプロジェクトを、更新日時の降順で返します。オープン・クローズ済みの両方を含みます。`totalCount` はプロジェクトの総数で、ページ内の件数やアイテム数ではありません。Organization 所有のプロジェクトが混ざった場合は `502 github_unavailable` になります。",
    validators: { query: projectsQuerySchema },
    response: {
      name: "ProjectsResponse",
      schema: projectsResponseSchema,
      description: "プロジェクト一覧の成功レスポンス。",
    },
  },
  listProjectItems: {
    path: "/api/projects/{number}/items",
    summary: "プロジェクトのアイテム一覧を取得",
    description:
      "プロジェクト内のアイテムを返します。`archived=0` は未アーカイブのみ、`archived=1` はアーカイブ済みと未アーカイブの両方です。プロジェクトが存在しない、Organization 所有、またはログインユーザー所有でない場合は `404 not_found` です。アイテムの総件数は返しません。アイテム一覧の `pageInfo` と、各アイテム内の `labels` / `fields` の `pageInfo` は独立しています。一覧ではラベルとフィールドを各先頭100件まで返すため、続きはアイテム詳細 API で取得してください。Issue / PullRequest の `labels` は `null` と空の接続を区別し、DraftIssue は GitHub 上に存在しない `url` / `number` / `repository` / `labels` を `null` で返します。",
    validators: {
      params: projectParamsSchema,
      query: projectItemsQuerySchema,
    },
    response: {
      name: "ProjectItemsResponse",
      schema: projectItemsResponseSchema,
      description:
        "プロジェクトのアイテム一覧の成功レスポンス。ラベルとフィールドは各先頭100件までです。",
    },
  },
  getProjectItem: {
    path: "/api/projects/{number}/items/{itemId}",
    summary: "アイテム詳細を取得",
    description:
      '1アイテムの詳細を返します。最大2回の GraphQL リクエストを使い、1回目は所有権と所属だけを確認し、2回目で本文・ラベル・フィールドを取得します。2回目でもプロジェクト ID と所有者を再確認し、確認できない場合は内容を返さず `404 not_found` にします。`first` はラベルとフィールドの両方に適用され、`labelsAfter` と `fieldsAfter` は独立しています。対応するフィールドは SINGLE_SELECT / TEXT / DATE / NUMBER で、小数はそのまま保持します。それ以外は `{ kind: "unsupported", sourceType }` として返します。既知の型で値や `dataType` が欠けている、または一致しない場合は `unsupported` にせず `502 github_unavailable` です。フィールド名のハードコードや集計は行いません。',
    validators: {
      params: projectItemParamsSchema,
      query: projectItemQuerySchema,
    },
    response: {
      name: "ProjectItemResponse",
      schema: projectItemResponseSchema,
      description: "アイテム詳細の成功レスポンス。",
    },
  },
} satisfies Record<string, ProjectOperation>;
