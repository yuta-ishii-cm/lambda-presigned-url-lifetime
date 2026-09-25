import { randomUUID } from 'node:crypto';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requireEnv } from '../lib/env.ts';
import { PROBE_OBJECT_KEY, type UrlRecord, parseIssuerKind, toLiveRecordKey } from '../lib/record.ts';
import { writeRecord } from '../lib/record-store.ts';
import { collectRuntimeInfo, createEnvironmentState, toSigningAccessKeyIdSuffix } from '../lib/runtime-info.ts';

/**
 * 署名付きURLに指定する有効期限（SigV4の上限の7日）
 *
 * @description 上限まで延ばしておくと、URLが使えなくなった時刻＝認証情報が失効した時刻になる
 */
const EXPIRES_IN_SECONDS = 604_800;

const environmentState = createEnvironmentState(randomUUID(), new Date());
const s3 = new S3Client({});

/**
 * 署名付きURLを1本発行し、実行環境の情報と一緒にバケットへ記録する
 */
export const handler = async (): Promise<void> => {
  const invokedAt = new Date();
  environmentState.invocationCount += 1;

  const bucketName = requireEnv('BUCKET_NAME');
  const issuerKind = parseIssuerKind(process.env.ISSUER_KIND);
  const runtime = collectRuntimeInfo({
    state: environmentState,
    invokedAt,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  });

  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucketName, Key: PROBE_OBJECT_KEY }), {
    expiresIn: EXPIRES_IN_SECONDS,
    signingDate: invokedAt,
  });

  const record: UrlRecord = {
    id: randomUUID(),
    issuerKind,
    issuedAt: invokedAt.toISOString(),
    expiresInSeconds: EXPIRES_IN_SECONDS,
    runtime,
    signingAccessKeyIdSuffix: toSigningAccessKeyIdSuffix(url),
    check: { lastOkAt: null, failure: null },
    url,
  };
  await writeRecord(s3, bucketName, toLiveRecordKey(record.id), record);

  console.log(
    JSON.stringify({
      message: 'issued',
      id: record.id,
      issuerKind,
      runtime,
      signingAccessKeyIdSuffix: record.signingAccessKeyIdSuffix,
    }),
  );
};
