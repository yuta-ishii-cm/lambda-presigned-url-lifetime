import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import { chunk } from '../src/lib/array.ts';
import { RECORD_PREFIX, type RecordSnapshot, type ResultRecord, dedupeRecords, omitUrl } from '../src/lib/record.ts';
import { listKeys, readRecordIfExists } from '../src/lib/record-store.ts';
import { OUTPUTS_PATH, SNAPSHOT_PATH, WORK_DIR } from './work-paths.ts';

/** スタック名（infra/app.ts と合わせる） */
const STACK_NAME = 'PresignedUrlLifetimeStack';

/** リージョン（infra/app.ts と合わせる） */
const REGION = 'ap-northeast-1';

/** 同時に読む記録の数 */
const FETCH_CONCURRENCY = 20;

/**
 * `cdk deploy --outputs-file` の出力からバケット名を読む
 *
 * @returns バケット名
 */
const readBucketName = async (): Promise<string> => {
  const outputs: unknown = JSON.parse(await readFile(OUTPUTS_PATH, 'utf8'));
  const bucketName = (outputs as Record<string, Record<string, unknown> | undefined>)[STACK_NAME]?.BucketName;
  if (typeof bucketName !== 'string') {
    throw new Error(`${OUTPUTS_PATH} に ${STACK_NAME}.BucketName がありません`);
  }
  return bucketName;
};

/**
 * バケットの記録を全部読み、URLを除いて .work/records.json に保存する
 */
const main = async (): Promise<void> => {
  const fetchedAt = new Date().toISOString();
  const bucketName = await readBucketName();
  const client = new S3Client({ region: REGION });
  const keys = await listKeys(client, bucketName, RECORD_PREFIX);

  const records: ResultRecord[] = [];
  for (const batch of chunk(keys, FETCH_CONCURRENCY)) {
    const fetched = await Promise.all(batch.map((key) => readRecordIfExists(client, bucketName, key)));
    records.push(...fetched.flatMap((record) => (record ? [omitUrl(record)] : [])));
  }

  const snapshot: RecordSnapshot = { fetchedAt, records: dedupeRecords(records) };
  await mkdir(WORK_DIR, { recursive: true });
  await writeFile(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`${snapshot.records.length}件の記録を ${path.relative(process.cwd(), SNAPSHOT_PATH)} に保存しました`);
};

await main();
