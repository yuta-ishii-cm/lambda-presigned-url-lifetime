import type { RuntimeInfo } from './runtime-info.ts';

/**
 * 発行Lambdaの種類
 *
 * @description `warm` は5分おきに呼んで実行環境を起動させたままにする常時起動用、
 * `cold` は1時間おきにだけ呼んで毎回ほぼ新しい実行環境で発行するコールドスタート用
 */
export type IssuerKind = 'warm' | 'cold';

/** 発行Lambdaの種類の一覧 */
export const ISSUER_KINDS: readonly IssuerKind[] = ['warm', 'cold'];

/** 署名付きURLで取得する固定オブジェクトのキー */
export const PROBE_OBJECT_KEY = 'probe.txt';

/** 記録を置くプレフィックス */
export const RECORD_PREFIX = 'records/';

/** 確認中（まだGETが成功している）の記録を置くプレフィックス */
export const LIVE_RECORD_PREFIX = `${RECORD_PREFIX}live/`;

/** GETの失敗を確認した記録を置くプレフィックス */
export const FAILED_RECORD_PREFIX = `${RECORD_PREFIX}failed/`;

/** GETが失敗したときの情報 */
export type CheckFailure = {
  /** 最初に失敗した時刻（ISO 8601） */
  failedAt: string;
  /** HTTPステータス */
  httpStatus: number;
  /** S3のエラーコード（`ExpiredToken` など） */
  errorCode: string | null;
  /** S3のエラーメッセージ */
  errorMessage: string | null;
};

/** 確認Lambdaが更新する確認結果 */
export type CheckState = {
  /** 最後にGETが成功した時刻（ISO 8601）。まだ確認していなければ `null` */
  lastOkAt: string | null;
  /** GETが失敗したときの情報。まだ失敗していなければ `null` */
  failure: CheckFailure | null;
};

/** 発行した署名付きURL1本分の記録 */
export type UrlRecord = {
  /** 記録ID */
  id: string;
  /** 発行Lambdaの種類 */
  issuerKind: IssuerKind;
  /** 発行時刻（ISO 8601） */
  issuedAt: string;
  /** 署名付きURLに指定した有効期限（秒） */
  expiresInSeconds: number;
  /** 発行した時点の実行環境の情報 */
  runtime: RuntimeInfo;
  /** 署名に使ったアクセスキーIDの末尾4文字（URLの `X-Amz-Credential` から取り出したもの） */
  signingAccessKeyIdSuffix: string;
  /** 確認結果 */
  check: CheckState;
  /** 署名付きURL。セッショントークンを含むため、バケットの外には出さない */
  url: string;
};

/** URLを除いた記録（ローカルへの保存・集計用） */
export type ResultRecord = Omit<UrlRecord, 'url'>;

/** バケットから取り出した記録のスナップショット */
export type RecordSnapshot = {
  /** バケットから取り出した時刻（ISO 8601） */
  fetchedAt: string;
  /** URLを除いた記録 */
  records: ResultRecord[];
};

/**
 * 確認中の記録のキーを作る
 *
 * @param id - 記録ID
 * @returns オブジェクトキー
 */
export const toLiveRecordKey = (id: string): string => `${LIVE_RECORD_PREFIX}${id}.json`;

/**
 * 失敗を確認した記録のキーを作る
 *
 * @param id - 記録ID
 * @returns オブジェクトキー
 */
export const toFailedRecordKey = (id: string): string => `${FAILED_RECORD_PREFIX}${id}.json`;

/**
 * 文字列を発行Lambdaの種類として解釈する
 *
 * @param value - 環境変数などの値
 * @returns 発行Lambdaの種類
 */
export const parseIssuerKind = (value: string | undefined): IssuerKind => {
  const kind = ISSUER_KINDS.find((candidate) => candidate === value);
  if (!kind) {
    throw new Error(`発行Lambdaの種類が不正です: ${value}`);
  }
  return kind;
};

/**
 * 記録からURLを取り除く
 *
 * @param record - バケットに置いている記録
 * @returns URLを除いた記録
 */
export const omitUrl = ({ url: _url, ...rest }: UrlRecord): ResultRecord => rest;

/**
 * 同じIDの記録を1つにまとめる
 *
 * @description 確認Lambdaは失敗済みの記録を書いてから確認中の記録を消すため、その間に取り出すと両方に同じIDが残っている。
 * その場合は失敗の情報を持つ方を残す
 * @param records - 記録
 * @returns IDが重複しない記録（最初に現れた順）
 */
export const dedupeRecords = (records: readonly ResultRecord[]): ResultRecord[] => {
  const byId = new Map<string, ResultRecord>();
  for (const record of records) {
    const existing = byId.get(record.id);
    if (!existing || (!existing.check.failure && record.check.failure)) {
      byId.set(record.id, record);
    }
  }
  return [...byId.values()];
};
