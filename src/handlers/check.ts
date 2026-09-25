import { S3Client } from '@aws-sdk/client-s3';
import { chunk } from '../lib/array.ts';
import { requireEnv } from '../lib/env.ts';
import { type ProbeOutcome, applyProbeOutcome, classifyProbeResponse } from '../lib/probe.ts';
import { LIVE_RECORD_PREFIX, toFailedRecordKey } from '../lib/record.ts';
import { createRecordIfAbsent, deleteRecord, listKeys, readRecord, writeRecord } from '../lib/record-store.ts';

/** 1本のURLのGETを待つ上限（ミリ秒） */
const PROBE_TIMEOUT_MILLISECONDS = 10_000;

/** 同時に確認するURLの数 */
const CHECK_CONCURRENCY = 20;

const s3 = new S3Client({});

/** 1回の確認で数える件数 */
type CheckCounts = Record<ProbeOutcome['kind'] | 'error', number>;

/**
 * ログに残すためにエラーの種類を取り出す
 *
 * @description fetch や JSON.parse のエラーメッセージにはURLや記録の断片が入ることがあるため、メッセージは残さない
 * @param error - 捕まえたエラー
 * @returns エラーの種類
 */
const toErrorName = (error: unknown): string => (error instanceof Error ? error.name : 'UnknownError');

/**
 * 署名付きURLをGETする
 *
 * @param url - 署名付きURL
 * @returns GETした結果
 */
const probe = async (url: string): Promise<ProbeOutcome> => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MILLISECONDS) });
    return classifyProbeResponse(response.status, await response.text());
  } catch (error) {
    return { kind: 'transient', reason: toErrorName(error) };
  }
};

/**
 * 1本のURLを確認し、結果を記録に反映する
 *
 * @description 失敗を確認した記録は `records/failed/` に移し、以後は確認しない
 * @param bucketName - バケット名
 * @param key - 確認中の記録のキー
 * @returns GETした結果の種類
 */
const checkRecord = async (bucketName: string, key: string): Promise<ProbeOutcome['kind']> => {
  const record = await readRecord(s3, bucketName, key);
  const probedAt = new Date();
  const outcome = await probe(record.url);
  const updated = applyProbeOutcome(record, outcome, probedAt);

  switch (outcome.kind) {
    case 'ok':
      await writeRecord(s3, bucketName, key, updated);
      break;
    case 'failed': {
      // 前回の確認で失敗済みの記録を書いたあと確認中の記録を消し損ねていた場合は、最初に検知した時刻を残す
      const created = await createRecordIfAbsent(s3, bucketName, toFailedRecordKey(record.id), updated);
      await deleteRecord(s3, bucketName, key);
      console.log(
        JSON.stringify({
          message: 'failed',
          id: record.id,
          issuerKind: record.issuerKind,
          failure: updated.check.failure,
          alreadyRecorded: !created,
        }),
      );
      break;
    }
    case 'transient':
      console.warn(JSON.stringify({ message: 'transient', id: record.id, reason: outcome.reason }));
      break;
  }
  return outcome.kind;
};

/**
 * まだ確認中の署名付きURLを全部GETし、失敗したものを失効として記録する
 *
 * @returns 結果の種類ごとの件数
 */
export const handler = async (): Promise<CheckCounts> => {
  const bucketName = requireEnv('BUCKET_NAME');
  const keys = await listKeys(s3, bucketName, LIVE_RECORD_PREFIX);

  const counts: CheckCounts = { ok: 0, failed: 0, transient: 0, error: 0 };
  for (const batch of chunk(keys, CHECK_CONCURRENCY)) {
    const results = await Promise.allSettled(batch.map((key) => checkRecord(bucketName, key)));
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        counts[result.value] += 1;
        return;
      }
      counts.error += 1;
      console.error(JSON.stringify({ message: 'error', key: batch[index], error: toErrorName(result.reason) }));
    });
  }

  console.log(JSON.stringify({ message: 'checked', ...counts }));
  if (counts.error) {
    throw new Error(`確認できなかった記録があります: ${counts.error}件`);
  }
  return counts;
};
