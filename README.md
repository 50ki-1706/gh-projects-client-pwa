# gh-projects-viewer-pwa

GitHub Projects をスマートフォンでも使いやすくする専用ビューアーです。

## features

- GitHub アカウントでのログイン
- 個人所有のプロジェクト一覧の取得
- プロジェクト内のアイテム一覧・詳細の取得

## API ドキュメント

アプリ起動後、次の URL で参照できます。

- `/docs`: API ドキュメント。
- `/docs/openapi`: OpenAPI 形式の API 仕様。

## 開発・検証

UI は Solid 2 の CSR 専用です。Void の同一オリジン API / 認証 worker は維持します。
構成と認証の境界は [architecture.md](architecture.md) を参照してください。

```sh
devenv shell -- pnpm install --frozen-lockfile
devenv shell -- pnpm dev
devenv shell -- pnpm typecheck
devenv shell -- pnpm typecheck:tsc
devenv shell -- pnpm test
devenv shell -- pnpm build
```

モック認証によるブラウザー検証手順は [tests/browser/README.md](tests/browser/README.md) を参照してください。
