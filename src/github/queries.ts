const PROJECT_FIELD_META_FRAGMENT = /* GraphQL */ `
  fragment ProjectFieldMeta on ProjectV2FieldCommon {
    id
    name
    dataType
  }
`;

const TASK_FIELD_VALUE_FRAGMENT = /* GraphQL */ `
  fragment TaskFieldValue on ProjectV2ItemFieldValue {
    __typename
    ... on ProjectV2ItemFieldSingleSelectValue {
      name
      optionId
      field {
        ...ProjectFieldMeta
      }
    }
    ... on ProjectV2ItemFieldTextValue {
      text
      field {
        ...ProjectFieldMeta
      }
    }
    ... on ProjectV2ItemFieldDateValue {
      date
      field {
        ...ProjectFieldMeta
      }
    }
    ... on ProjectV2ItemFieldNumberValue {
      number
      field {
        ...ProjectFieldMeta
      }
    }
  }
`;

const TASK_CONTENT_FRAGMENT = /* GraphQL */ `
  fragment TaskContent on ProjectV2ItemContent {
    __typename
    ... on Issue {
      title
      body
      url
      number
      state
      createdAt
      updatedAt
      repository {
        nameWithOwner
        url
      }
      labels(first: $labelsFirst, after: $labelsAfter) {
        nodes {
          id
          name
          color
          description
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
    ... on PullRequest {
      title
      body
      url
      number
      state
      createdAt
      updatedAt
      repository {
        nameWithOwner
        url
      }
      labels(first: $labelsFirst, after: $labelsAfter) {
        nodes {
          id
          name
          color
          description
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
    ... on DraftIssue {
      title
      body
      createdAt
      updatedAt
    }
  }
`;

const TASK_FRAGMENT = /* GraphQL */ `
  fragment TaskFields on ProjectV2Item {
    id
    type
    isArchived
    createdAt
    updatedAt
    content {
      ...TaskContent
    }
    fieldValues(first: $fieldsFirst, after: $fieldsAfter) {
      nodes {
        ...TaskFieldValue
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const TASK_FRAGMENTS = [
  PROJECT_FIELD_META_FRAGMENT,
  TASK_FIELD_VALUE_FRAGMENT,
  TASK_CONTENT_FRAGMENT,
  TASK_FRAGMENT,
].join("\n");

export const PROJECTS_QUERY = /* GraphQL */ `
  query ViewerProjects($first: Int!, $after: String) {
    viewer {
      id
      projectsV2(
        first: $first
        after: $after
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        nodes {
          id
          number
          title
          shortDescription
          url
          closed
          public
          updatedAt
          owner {
            __typename
            id
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
        totalCount
      }
    }
  }
`;

export const PROJECT_ITEMS_QUERY = /* GraphQL */ `
  query ViewerProjectItems(
    $number: Int!
    $first: Int!
    $after: String
    $archivedStates: [ProjectV2ItemArchivedState!]!
    $labelsFirst: Int!
    $labelsAfter: String
    $fieldsFirst: Int!
    $fieldsAfter: String
  ) {
    viewer {
      id
      projectV2(number: $number) {
        id
        number
        title
        shortDescription
        owner {
          __typename
          id
        }
        items(first: $first, after: $after, archivedStates: $archivedStates) {
          nodes {
            ...TaskFields
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
  ${TASK_FRAGMENTS}
`;

export const PROJECT_ITEM_ACCESS_QUERY = /* GraphQL */ `
  query ProjectItemAccess($number: Int!, $itemId: ID!) {
    viewer {
      id
      projectV2(number: $number) {
        id
        number
        title
        shortDescription
        owner {
          __typename
          id
        }
      }
    }
    node(id: $itemId) {
      __typename
      ... on ProjectV2Item {
        id
        project {
          id
        }
      }
    }
  }
`;

export const PROJECT_ITEM_DETAIL_QUERY = /* GraphQL */ `
  query ProjectItemDetail(
    $itemId: ID!
    $labelsFirst: Int!
    $labelsAfter: String
    $fieldsFirst: Int!
    $fieldsAfter: String
  ) {
    node(id: $itemId) {
      __typename
      ... on ProjectV2Item {
        ...TaskFields
        project {
          id
          owner {
            __typename
            id
          }
        }
      }
    }
  }
  ${TASK_FRAGMENTS}
`;
