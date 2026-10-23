import { GitHubApiError } from "./errors.ts";
import {
  PROJECTS_QUERY,
  PROJECT_ITEMS_QUERY,
  PROJECT_ITEM_ACCESS_QUERY,
  PROJECT_ITEM_DETAIL_QUERY,
} from "./queries.ts";
import { githubGraphQL, type FetchLike } from "./client.ts";
import {
  projectItemAccessResponseDataSchema,
  projectItemDetailResponseDataSchema,
  projectItemsResponseDataSchema,
  projectsResponseDataSchema,
  type FieldValueRaw,
  type NormalizedField,
  type ProjectItemParams,
  type ProjectItemQuery,
  type ProjectItemResponse,
  type ProjectItemsQuery,
  type ProjectItemsResponse,
  type ProjectMetadata,
  type ProjectNode,
  type ProjectParams,
  type ProjectsQuery,
  type ProjectsResponse,
  type TaskDTO,
  type TaskRaw,
} from "./schemas.ts";

type CommonOperationOptions = {
  token: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

export async function listProjects(
  options: CommonOperationOptions & ProjectsQuery,
): Promise<ProjectsResponse> {
  const data = await githubGraphQL({
    token: options.token,
    query: PROJECTS_QUERY,
    variables: {
      first: options.first,
      after: options.after ?? null,
    },
    schema: projectsResponseDataSchema,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });

  const projects = data.viewer.projectsV2.nodes;
  for (const project of projects) {
    if (!isPersonalOwner(project.owner, data.viewer.id)) {
      throw new GitHubApiError("github_unavailable");
    }
  }

  return {
    projects: projects.map(mapProjectListItem),
    pageInfo: data.viewer.projectsV2.pageInfo,
    totalCount: data.viewer.projectsV2.totalCount,
  };
}

export async function listProjectItems(
  options: CommonOperationOptions & ProjectParams & ProjectItemsQuery,
): Promise<ProjectItemsResponse> {
  const data = await githubGraphQL({
    token: options.token,
    query: PROJECT_ITEMS_QUERY,
    variables: {
      number: options.number,
      first: options.first,
      after: options.after ?? null,
      archivedStates: options.archived
        ? ["ARCHIVED", "NOT_ARCHIVED"]
        : ["NOT_ARCHIVED"],
      labelsFirst: 100,
      labelsAfter: null,
      fieldsFirst: 100,
      fieldsAfter: null,
    },
    schema: projectItemsResponseDataSchema,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });

  const project = data.viewer.projectV2;
  if (project === null || !isPersonalOwner(project.owner, data.viewer.id)) {
    throw new GitHubApiError("not_found");
  }

  return {
    project: mapProjectMetadata(project),
    items: project.items.nodes.map(mapTask),
    pageInfo: project.items.pageInfo,
  };
}

export async function getProjectItem(
  options: CommonOperationOptions & ProjectItemParams & ProjectItemQuery,
): Promise<ProjectItemResponse> {
  const access = await githubGraphQL({
    token: options.token,
    query: PROJECT_ITEM_ACCESS_QUERY,
    variables: {
      number: options.number,
      itemId: options.itemId,
    },
    schema: projectItemAccessResponseDataSchema,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });

  const project = access.viewer.projectV2;
  if (project === null || !isPersonalOwner(project.owner, access.viewer.id)) {
    throw new GitHubApiError("not_found");
  }

  const accessNode = access.node;
  if (
    accessNode === null ||
    "otherNode" in accessNode ||
    accessNode.id !== options.itemId ||
    accessNode.project.id !== project.id
  ) {
    throw new GitHubApiError("not_found");
  }

  const detail = await githubGraphQL({
    token: options.token,
    query: PROJECT_ITEM_DETAIL_QUERY,
    variables: {
      itemId: options.itemId,
      labelsFirst: options.first,
      labelsAfter: options.labelsAfter ?? null,
      fieldsFirst: options.first,
      fieldsAfter: options.fieldsAfter ?? null,
    },
    schema: projectItemDetailResponseDataSchema,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });

  const detailNode = detail.node;
  if (
    detailNode === null ||
    "otherNode" in detailNode ||
    detailNode.id !== options.itemId ||
    detailNode.project.id !== project.id ||
    !isPersonalOwner(detailNode.project.owner, access.viewer.id)
  ) {
    throw new GitHubApiError("not_found");
  }

  return {
    project: mapProjectMetadata(project),
    item: mapTask(detailNode),
  };
}

function isPersonalOwner(
  owner: { __typename: "User" | "Organization"; id: string },
  viewerId: string,
): boolean {
  return owner.__typename === "User" && owner.id === viewerId;
}

function mapProjectMetadata(project: ProjectMetadata): ProjectMetadata {
  return {
    id: project.id,
    number: project.number,
    title: project.title,
    shortDescription: project.shortDescription,
  };
}

function mapProjectListItem(project: ProjectNode) {
  return {
    ...mapProjectMetadata(project),
    url: project.url,
    closed: project.closed,
    public: project.public,
    updatedAt: project.updatedAt,
  };
}

function mapTask(item: TaskRaw): TaskDTO {
  return {
    id: item.id,
    type: item.type,
    isArchived: item.isArchived,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    content: mapContent(item.content),
    fields: {
      nodes: item.fieldValues.nodes.map(mapFieldValue),
      pageInfo: item.fieldValues.pageInfo,
    },
  };
}

function mapContent(content: TaskRaw["content"]): TaskDTO["content"] {
  if (content === null) {
    return null;
  }

  switch (content.__typename) {
    case "Issue":
    case "PullRequest":
      return {
        kind: content.__typename === "Issue" ? "issue" : "pullRequest",
        title: content.title,
        body: content.body,
        url: content.url,
        number: content.number,
        state: content.state,
        repository: content.repository,
        createdAt: content.createdAt,
        updatedAt: content.updatedAt,
        labels: content.labels,
      };
    case "DraftIssue":
      return {
        kind: "draftIssue",
        title: content.title,
        body: content.body,
        url: null,
        number: null,
        repository: null,
        createdAt: content.createdAt,
        updatedAt: content.updatedAt,
        labels: null,
      };
  }
}

function mapFieldValue(value: FieldValueRaw): NormalizedField {
  if ("unsupported" in value) {
    return {
      kind: "unsupported",
      sourceType: value.__typename,
    };
  }

  switch (value.__typename) {
    case "ProjectV2ItemFieldSingleSelectValue":
      return {
        kind: "singleSelect",
        fieldId: value.field.id,
        name: value.field.name,
        dataType: "SINGLE_SELECT",
        optionId: value.optionId,
        optionName: value.name,
      };
    case "ProjectV2ItemFieldTextValue":
      return {
        kind: "text",
        fieldId: value.field.id,
        name: value.field.name,
        dataType: "TEXT",
        value: value.text,
      };
    case "ProjectV2ItemFieldDateValue":
      return {
        kind: "date",
        fieldId: value.field.id,
        name: value.field.name,
        dataType: "DATE",
        value: value.date,
      };
    case "ProjectV2ItemFieldNumberValue":
      return {
        kind: "number",
        fieldId: value.field.id,
        name: value.field.name,
        dataType: "NUMBER",
        value: value.number,
      };
  }
}
