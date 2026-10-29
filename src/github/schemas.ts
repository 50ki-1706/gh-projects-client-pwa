import * as v from "valibot";

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/u;
const GRAPHQL_INT_MAX = 2147483647;

const idSchema = v.pipe(v.string(), v.minLength(1));
const urlSchema = v.pipe(v.string(), v.url());
const dateTimeSchema = v.pipe(v.string(), v.isoTimestamp());
const graphqlTypeNameSchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.maxLength(128),
);
const cursorSchema = v.pipe(
  v.string(),
  v.description(
    "不透明なページネーションカーソル。1〜2048文字で、制御文字（C0、DEL、C1）を含められません。",
  ),
  v.minLength(1),
  v.maxLength(2048),
  v.check((value) => !CONTROL_CHARACTERS.test(value)),
);
const shortDescriptionSchema = v.nullable(v.string());
const graphqlIntSchema = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(1),
  v.maxValue(GRAPHQL_INT_MAX),
);
const totalCountSchema = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(0),
  v.maxValue(GRAPHQL_INT_MAX),
);

const firstInputSchema = v.pipe(
  v.string(),
  v.description(
    "ASCII 数字のみからなる1〜3桁の文字列。1〜100の整数に変換されます。",
  ),
  v.regex(/^[0-9]{1,3}$/),
  v.transform((value) => Number(value)),
  v.integer(),
  v.minValue(1),
  v.maxValue(100),
);

export const projectsQuerySchema = v.object({
  first: v.optional(firstInputSchema, "20"),
  after: v.optional(cursorSchema),
});

export const projectItemsQuerySchema = v.object({
  first: v.optional(firstInputSchema, "20"),
  after: v.optional(cursorSchema),
  archived: v.optional(
    v.pipe(
      v.picklist(["0", "1"]),
      v.description(
        "`0` は未アーカイブのみ、`1` はアーカイブ済みと未アーカイブの両方です。",
      ),
      v.transform((value) => value === "1"),
    ),
    "0",
  ),
});

export const projectItemQuerySchema = v.object({
  first: v.optional(firstInputSchema, "100"),
  labelsAfter: v.optional(cursorSchema),
  fieldsAfter: v.optional(cursorSchema),
});

const projectNumberInputSchema = v.pipe(
  v.string(),
  v.description(
    "ASCII 数字のみからなる1〜10桁の文字列。1〜2147483647の整数に変換されます。",
  ),
  v.regex(/^[0-9]{1,10}$/),
  v.transform((value) => Number(value)),
  v.integer(),
  v.minValue(1),
  v.maxValue(GRAPHQL_INT_MAX),
);

const itemIdInputSchema = v.pipe(
  v.string(),
  v.description(
    "GitHub GraphQL の ProjectV2Item ID（不透明文字列）。1〜512文字で、制御文字（C0、DEL、C1）を含められません。",
  ),
  v.minLength(1),
  v.maxLength(512),
  v.check((value) => !CONTROL_CHARACTERS.test(value)),
);

export const projectParamsSchema = v.object({
  number: projectNumberInputSchema,
});

export const projectItemParamsSchema = v.object({
  number: projectNumberInputSchema,
  itemId: itemIdInputSchema,
});

export const graphqlErrorSchema = v.object({
  type: v.nullish(v.string()),
  extensions: v.nullish(
    v.object({
      code: v.nullish(v.string()),
    }),
  ),
});

export const graphqlEnvelopeSchema = v.object({
  data: v.optional(v.unknown()),
  errors: v.optional(v.array(graphqlErrorSchema)),
});

export const githubTokenRowsSchema = v.array(
  v.object({
    accessToken: v.nullable(v.string()),
  }),
);

export const pageInfoSchema = v.pipe(
  v.object({
    hasNextPage: v.boolean(),
    endCursor: v.nullable(cursorSchema),
  }),
  v.description(
    "`hasNextPage` が `true` の場合は `endCursor` が必ず存在します。",
  ),
  v.check((page) => !page.hasNextPage || page.endCursor !== null),
);

const ownerSchema = v.object({
  __typename: v.picklist(["User", "Organization"]),
  id: idSchema,
});

const projectMetadataBase = {
  id: idSchema,
  number: graphqlIntSchema,
  title: v.string(),
  shortDescription: shortDescriptionSchema,
};

const projectMetadataRawSchema = v.object({
  ...projectMetadataBase,
  owner: ownerSchema,
});

const projectNodeSchema = v.object({
  ...projectMetadataBase,
  owner: ownerSchema,
  url: urlSchema,
  closed: v.boolean(),
  public: v.boolean(),
  updatedAt: dateTimeSchema,
});

const viewerBase = {
  id: idSchema,
};

export const projectsResponseDataSchema = v.object({
  viewer: v.object({
    ...viewerBase,
    projectsV2: v.object({
      nodes: v.array(projectNodeSchema),
      pageInfo: pageInfoSchema,
      totalCount: totalCountSchema,
    }),
  }),
});

const labelSchema = v.object({
  id: idSchema,
  name: v.string(),
  color: v.string(),
  description: v.nullable(v.string()),
});

const labelConnectionSchema = v.object({
  nodes: v.array(labelSchema),
  pageInfo: pageInfoSchema,
});

const repositorySchema = v.object({
  nameWithOwner: v.pipe(v.string(), v.minLength(1)),
  url: urlSchema,
});

const contentBase = {
  title: v.string(),
  body: v.nullable(v.string()),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
};

const repositoryContentBase = {
  ...contentBase,
  url: urlSchema,
  number: graphqlIntSchema,
  state: v.string(),
  repository: repositorySchema,
  labels: v.nullable(labelConnectionSchema),
};

const issueContentSchema = v.object({
  __typename: v.literal("Issue"),
  ...repositoryContentBase,
});

const pullRequestContentSchema = v.object({
  __typename: v.literal("PullRequest"),
  ...repositoryContentBase,
});

const draftIssueContentSchema = v.object({
  __typename: v.literal("DraftIssue"),
  ...contentBase,
});

const itemContentSchema = v.variant("__typename", [
  issueContentSchema,
  pullRequestContentSchema,
  draftIssueContentSchema,
]);

const fieldMetadataBase = {
  id: idSchema,
  name: v.string(),
};

const supportedFieldValueTypeNames = new Set([
  "ProjectV2ItemFieldSingleSelectValue",
  "ProjectV2ItemFieldTextValue",
  "ProjectV2ItemFieldDateValue",
  "ProjectV2ItemFieldNumberValue",
]);

const singleSelectFieldValueSchema = v.object({
  __typename: v.literal("ProjectV2ItemFieldSingleSelectValue"),
  name: v.nullable(v.string()),
  optionId: v.nullable(v.string()),
  field: v.object({
    ...fieldMetadataBase,
    dataType: v.literal("SINGLE_SELECT"),
  }),
});

const textFieldValueSchema = v.object({
  __typename: v.literal("ProjectV2ItemFieldTextValue"),
  text: v.nullable(v.string()),
  field: v.object({ ...fieldMetadataBase, dataType: v.literal("TEXT") }),
});

const dateFieldValueSchema = v.object({
  __typename: v.literal("ProjectV2ItemFieldDateValue"),
  date: v.nullable(v.pipe(v.string(), v.isoDate())),
  field: v.object({ ...fieldMetadataBase, dataType: v.literal("DATE") }),
});

const numberFieldValueSchema = v.object({
  __typename: v.literal("ProjectV2ItemFieldNumberValue"),
  number: v.nullable(v.number()),
  field: v.object({ ...fieldMetadataBase, dataType: v.literal("NUMBER") }),
});

const unsupportedFieldValueSchema = v.pipe(
  v.object({
    __typename: v.pipe(
      graphqlTypeNameSchema,
      v.check((value) => !supportedFieldValueTypeNames.has(value)),
    ),
  }),
  v.transform((value) => ({
    __typename: value.__typename,
    unsupported: true as const,
  })),
);

const fieldValueSchema = v.union([
  singleSelectFieldValueSchema,
  textFieldValueSchema,
  dateFieldValueSchema,
  numberFieldValueSchema,
  unsupportedFieldValueSchema,
]);

const otherNodeSchema = v.pipe(
  v.object({
    __typename: v.pipe(
      graphqlTypeNameSchema,
      v.check((value) => value !== "ProjectV2Item"),
    ),
  }),
  v.transform((value) => ({
    __typename: value.__typename,
    otherNode: true as const,
  })),
);

const fieldValueConnectionSchema = v.object({
  nodes: v.array(fieldValueSchema),
  pageInfo: pageInfoSchema,
});

const taskTypeSchema = v.picklist([
  "ISSUE",
  "PULL_REQUEST",
  "DRAFT_ISSUE",
  "REDACTED",
]);

const taskBase = {
  id: idSchema,
  type: taskTypeSchema,
  isArchived: v.boolean(),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
};

const taskRawObjectSchema = v.object({
  ...taskBase,
  content: v.nullable(itemContentSchema),
  fieldValues: fieldValueConnectionSchema,
});

function hasConsistentContent(
  item: v.InferOutput<typeof taskRawObjectSchema>,
): boolean {
  if (item.content === null) return true;
  switch (item.content.__typename) {
    case "Issue":
      return item.type === "ISSUE";
    case "PullRequest":
      return item.type === "PULL_REQUEST";
    case "DraftIssue":
      return item.type === "DRAFT_ISSUE";
  }
}

const taskRawSchema = v.pipe(
  taskRawObjectSchema,
  v.check((item) => hasConsistentContent(item)),
);

export const projectItemsResponseDataSchema = v.object({
  viewer: v.object({
    ...viewerBase,
    projectV2: v.nullable(
      v.object({
        ...projectMetadataBase,
        owner: ownerSchema,
        items: v.object({
          nodes: v.array(taskRawSchema),
          pageInfo: pageInfoSchema,
        }),
      }),
    ),
  }),
});

const itemAccessNodeSchema = v.object({
  __typename: v.literal("ProjectV2Item"),
  id: idSchema,
  project: v.object({
    id: idSchema,
  }),
});

export const projectItemAccessResponseDataSchema = v.object({
  viewer: v.object({
    ...viewerBase,
    projectV2: v.nullable(projectMetadataRawSchema),
  }),
  node: v.nullable(v.union([itemAccessNodeSchema, otherNodeSchema])),
});

const itemDetailNodeSchema = v.pipe(
  v.object({
    __typename: v.literal("ProjectV2Item"),
    ...taskRawObjectSchema.entries,
    project: v.object({
      id: idSchema,
      owner: ownerSchema,
    }),
  }),
  v.check((item) => hasConsistentContent(item)),
);

export const projectItemDetailResponseDataSchema = v.object({
  node: v.nullable(v.union([itemDetailNodeSchema, otherNodeSchema])),
});

export const projectMetadataSchema = v.object(projectMetadataBase);

export const projectListItemSchema = v.object({
  ...projectMetadataBase,
  url: urlSchema,
  closed: v.boolean(),
  public: v.boolean(),
  updatedAt: dateTimeSchema,
});

export const normalizedFieldSchema = v.variant("kind", [
  v.object({
    kind: v.literal("singleSelect"),
    fieldId: idSchema,
    name: v.string(),
    dataType: v.literal("SINGLE_SELECT"),
    optionId: v.nullable(v.string()),
    optionName: v.nullable(v.string()),
  }),
  v.object({
    kind: v.literal("text"),
    fieldId: idSchema,
    name: v.string(),
    dataType: v.literal("TEXT"),
    value: v.nullable(v.string()),
  }),
  v.object({
    kind: v.literal("date"),
    fieldId: idSchema,
    name: v.string(),
    dataType: v.literal("DATE"),
    value: v.nullable(v.string()),
  }),
  v.object({
    kind: v.literal("number"),
    fieldId: idSchema,
    name: v.string(),
    dataType: v.literal("NUMBER"),
    value: v.nullable(v.number()),
  }),
  v.object({
    kind: v.literal("unsupported"),
    sourceType: v.string(),
  }),
]);

const issueContentDtoSchema = v.object({
  kind: v.literal("issue"),
  ...repositoryContentBase,
});

const pullRequestContentDtoSchema = v.object({
  kind: v.literal("pullRequest"),
  ...repositoryContentBase,
});

const draftIssueContentDtoSchema = v.object({
  kind: v.literal("draftIssue"),
  ...contentBase,
  url: v.null(),
  number: v.null(),
  repository: v.null(),
  labels: v.null(),
});

export const taskContentSchema = v.nullable(
  v.variant("kind", [
    issueContentDtoSchema,
    pullRequestContentDtoSchema,
    draftIssueContentDtoSchema,
  ]),
);

export const taskSchema = v.object({
  ...taskBase,
  content: taskContentSchema,
  fields: v.object({
    nodes: v.array(normalizedFieldSchema),
    pageInfo: pageInfoSchema,
  }),
});

export const projectsResponseSchema = v.object({
  projects: v.array(projectListItemSchema),
  pageInfo: pageInfoSchema,
  totalCount: totalCountSchema,
});

export const projectItemsResponseSchema = v.object({
  project: projectMetadataSchema,
  items: v.array(taskSchema),
  pageInfo: pageInfoSchema,
});

export const projectItemResponseSchema = v.object({
  project: projectMetadataSchema,
  item: taskSchema,
});

export type ProjectsQuery = v.InferOutput<typeof projectsQuerySchema>;
export type ProjectItemsQuery = v.InferOutput<typeof projectItemsQuerySchema>;
export type ProjectItemQuery = v.InferOutput<typeof projectItemQuerySchema>;
export type ProjectParams = v.InferOutput<typeof projectParamsSchema>;
export type ProjectItemParams = v.InferOutput<typeof projectItemParamsSchema>;
export type GitHubTokenRow = v.InferOutput<
  typeof githubTokenRowsSchema
>[number];
export type PageInfo = v.InferOutput<typeof pageInfoSchema>;
export type ProjectMetadata = v.InferOutput<typeof projectMetadataSchema>;
export type ProjectListItem = v.InferOutput<typeof projectListItemSchema>;
export type ProjectNode = v.InferOutput<typeof projectNodeSchema>;
export type Label = v.InferOutput<typeof labelSchema>;
export type LabelConnection = v.InferOutput<typeof labelConnectionSchema>;
export type NormalizedField = v.InferOutput<typeof normalizedFieldSchema>;
export type TaskContent = v.InferOutput<typeof taskContentSchema>;
export type TaskDTO = v.InferOutput<typeof taskSchema>;
export type TaskRaw = v.InferOutput<typeof taskRawSchema>;
export type FieldValueRaw = v.InferOutput<typeof fieldValueSchema>;
export type ItemAccessNode = v.InferOutput<typeof itemAccessNodeSchema>;
export type ItemDetailNode = v.InferOutput<typeof itemDetailNodeSchema>;
export type GraphQLError = v.InferOutput<typeof graphqlErrorSchema>;
export type ProjectsResponse = v.InferOutput<typeof projectsResponseSchema>;
export type ProjectItemsResponse = v.InferOutput<
  typeof projectItemsResponseSchema
>;
export type ProjectItemResponse = v.InferOutput<
  typeof projectItemResponseSchema
>;
