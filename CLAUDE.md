# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

Lambdaの実行ロールの認証情報で発行したS3署名付きURLが、実際に何時間有効なのかを測る検証リポジトリ。背景・計測方法・作業の進め方は [docs/plan.md](docs/plan.md) にまとまっている。作業を始める前に必ず読むこと。

## コマンド

```bash
pnpm install
pnpm test                   # 全テスト（node --test、ローカルのみ）
pnpm type-check             # tsc（noEmit）

aws-vault exec <profile> -- pnpm cdk deploy --outputs-file .work/outputs.json
aws-vault exec <profile> -- pnpm cdk destroy

aws-vault exec <profile> -- pnpm fetch-records   # バケットの記録をURLを除いて .work/records.json に保存
pnpm summarize                                  # .work/records.json を集計して .work/summary.md に書き出す
```

- `<profile>` は各自の aws-vault のプロファイル名に置き換える
- リージョンは `ap-northeast-1` 固定（`infra/app.ts`）
- `scripts/` を作る場合は、バケット名などを `.work/outputs.json`（`cdk deploy --outputs-file` の出力）から読む

## TypeScriptの実行形態

ビルド工程はない。Node.js 24がTypeScriptをそのまま実行する（型の除去のみ）。CDKアプリも `node infra/app.ts` で動く。Lambdaは CDK の `NodejsFunction`（esbuild）でバンドルする。

- importは `.ts` 拡張子付きで書く（`allowImportingTsExtensions`）
- `erasableSyntaxOnly` のため、`enum`・`namespace`・コンストラクタのパラメータプロパティなど、型の除去だけで消せない構文は使えない
- `verbatimModuleSyntax` のため、型だけのimportは `import type` / `type` 修飾子を付ける

## リポジトリの約束ごと

- コメント・JSDoc・README・docsは日本語で書く
- `.work/`（デプロイ出力・ログ・結果）、`articles/`（ブログ原稿）、`cdk.context.json`（アカウントIDを含む）はgit管理外。`cdk.context.json` はコミットしない
- 署名付きURLにはセッショントークンが含まれる。URLそのものをコミット・ログ出力・ブログ掲載しない。アクセスキーIDは末尾4文字だけ扱う
- pnpm 12のビルドスクリプト許可は `pnpm-workspace.yaml` の `allowBuilds` で管理する（`package.json` の `pnpm.ignoredBuiltDependencies` は効かない）
- 計測を止めたら、定期実行を残したままにしない（`cdk destroy` まで行う）
