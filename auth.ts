import { defineAuth } from "void/auth";

const PROJECTS_SCOPE = "read:project";

export default defineAuth(({ defaults }) => {
  const socialProviders = defaults.socialProviders;
  const github = socialProviders?.github;

  if (
    typeof socialProviders !== "object" ||
    socialProviders === null ||
    typeof github !== "object" ||
    github === null
  ) {
    throw new Error("auth: GitHub プロバイダーの設定が見つかりません。");
  }

  const existingScope = Array.isArray(github.scope) ? github.scope : [];

  return {
    ...defaults,
    socialProviders: {
      ...socialProviders,
      github: {
        ...github,
        scope: [
          ...existingScope.filter((scope) => scope !== PROJECTS_SCOPE),
          PROJECTS_SCOPE,
        ],
      },
    },
  };
});
