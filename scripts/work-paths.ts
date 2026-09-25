import path from 'node:path';

/** デプロイ出力・結果を置くディレクトリ（git管理外） */
export const WORK_DIR = path.join(import.meta.dirname, '../.work');

/** `cdk deploy --outputs-file` の出力 */
export const OUTPUTS_PATH = path.join(WORK_DIR, 'outputs.json');

/** バケットから取り出した記録（URLを除いたもの） */
export const SNAPSHOT_PATH = path.join(WORK_DIR, 'records.json');

/** 集計結果のMarkdown */
export const SUMMARY_PATH = path.join(WORK_DIR, 'summary.md');
