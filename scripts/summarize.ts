import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RecordSnapshot } from '../src/lib/record.ts';
import { renderSummaryMarkdown, renderUrlTableMarkdown } from '../src/lib/summary.ts';
import { SNAPSHOT_PATH, SUMMARY_PATH } from './work-paths.ts';

/**
 * .work/records.json を集計し、.work/summary.md に書き出す
 *
 * @description 標準出力には全体の集計だけを出し、URLごとの一覧はファイルにだけ書く
 */
const main = async (): Promise<void> => {
  const snapshot = JSON.parse(await readFile(SNAPSHOT_PATH, 'utf8')) as RecordSnapshot;
  const summary = renderSummaryMarkdown(snapshot);

  await writeFile(SUMMARY_PATH, [summary, renderUrlTableMarkdown(snapshot.records)].join('\n'));
  console.log(summary);
  console.log(`URLごとの一覧も含めて ${path.relative(process.cwd(), SUMMARY_PATH)} に書き出しました`);
};

await main();
