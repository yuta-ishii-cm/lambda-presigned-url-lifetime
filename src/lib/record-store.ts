import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  type PutObjectCommandInput,
  type S3Client,
  paginateListObjectsV2,
} from '@aws-sdk/client-s3';
import type { UrlRecord } from './record.ts';

/** 条件付き書き込みで、同じキーのオブジェクトが既にあったときのエラー名 */
const PRECONDITION_FAILED_ERROR_NAME = 'PreconditionFailed';

/**
 * プレフィックス配下のオブジェクトキーを全部取り出す
 *
 * @param client - S3クライアント
 * @param bucketName - バケット名
 * @param prefix - プレフィックス
 * @returns オブジェクトキーの一覧
 */
export const listKeys = async (client: S3Client, bucketName: string, prefix: string): Promise<string[]> => {
  const keys: string[] = [];
  for await (const page of paginateListObjectsV2({ client }, { Bucket: bucketName, Prefix: prefix })) {
    for (const object of page.Contents ?? []) {
      if (object.Key) {
        keys.push(object.Key);
      }
    }
  }
  return keys;
};

/**
 * 記録を読む
 *
 * @param client - S3クライアント
 * @param bucketName - バケット名
 * @param key - オブジェクトキー
 * @returns 記録
 */
export const readRecord = async (client: S3Client, bucketName: string, key: string): Promise<UrlRecord> => {
  const response = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
  const body = await response.Body?.transformToString();
  if (!body) {
    throw new Error(`記録が空です: ${key}`);
  }
  return JSON.parse(body) as UrlRecord;
};

/**
 * 記録があれば読む
 *
 * @description 一覧を取ってから読むまでの間に、確認Lambdaが記録を移していることがある
 * @param client - S3クライアント
 * @param bucketName - バケット名
 * @param key - オブジェクトキー
 * @returns 記録。もうなければ `null`
 */
export const readRecordIfExists = async (client: S3Client, bucketName: string, key: string): Promise<UrlRecord | null> => {
  try {
    return await readRecord(client, bucketName, key);
  } catch (error) {
    if (error instanceof NoSuchKey) {
      return null;
    }
    throw error;
  }
};

/**
 * 記録を書き込むリクエストの内容を作る
 *
 * @param bucketName - バケット名
 * @param key - オブジェクトキー
 * @param record - 記録
 * @returns PutObjectのリクエストの内容
 */
const toPutRecordInput = (bucketName: string, key: string, record: UrlRecord): PutObjectCommandInput => ({
  Bucket: bucketName,
  Key: key,
  Body: JSON.stringify(record),
  ContentType: 'application/json',
});

/**
 * 記録を書く
 *
 * @param client - S3クライアント
 * @param bucketName - バケット名
 * @param key - オブジェクトキー
 * @param record - 記録
 */
export const writeRecord = async (client: S3Client, bucketName: string, key: string, record: UrlRecord): Promise<void> => {
  await client.send(new PutObjectCommand(toPutRecordInput(bucketName, key, record)));
};

/**
 * 同じキーの記録がまだないときだけ書く
 *
 * @param client - S3クライアント
 * @param bucketName - バケット名
 * @param key - オブジェクトキー
 * @param record - 記録
 * @returns 書いたら `true`、既にあって書かなかったら `false`
 */
export const createRecordIfAbsent = async (
  client: S3Client,
  bucketName: string,
  key: string,
  record: UrlRecord,
): Promise<boolean> => {
  try {
    await client.send(new PutObjectCommand({ ...toPutRecordInput(bucketName, key, record), IfNoneMatch: '*' }));
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === PRECONDITION_FAILED_ERROR_NAME) {
      return false;
    }
    throw error;
  }
};

/**
 * 記録を消す
 *
 * @param client - S3クライアント
 * @param bucketName - バケット名
 * @param key - オブジェクトキー
 */
export const deleteRecord = async (client: S3Client, bucketName: string, key: string): Promise<void> => {
  await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
};
