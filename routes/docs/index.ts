import { defineHandler } from "void";

const SCALAR_CDN_URL =
  "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.75.1/esm.js";

export const GET = defineHandler(
  () => `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GitHub Projects 読み取り API ドキュメント</title>
  </head>
  <body>
    <div id="app"></div>
    <p>
      <a href="/docs/openapi">OpenAPI JSON</a>
      （CDN を読み込めない場合はこちらを参照してください）
    </p>
    <script type="module">
      import { createApiReference } from "${SCALAR_CDN_URL}";

      createApiReference("#app", { url: "/docs/openapi" });
    </script>
  </body>
</html>`,
);
