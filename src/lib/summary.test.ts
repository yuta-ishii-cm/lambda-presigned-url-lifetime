import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CheckFailure, IssuerKind, ResultRecord } from './record.ts';
import {
  formatDuration,
  formatJst,
  secondsBetween,
  summarizeByCredential,
  summarizeByElapsed,
  summarizeErrors,
  toFailedAfterSeconds,
  toLastOkAfterSeconds,
} from './summary.ts';

/** テスト用の記録を作るときに変える項目 */
type RecordOverrides = {
  /** 記録ID */
  id: string;
  /** 発行Lambdaの種類 */
  issuerKind: IssuerKind;
  /** 発行時刻 */
  issuedAt: string;
  /** 実行環境ID */
  environmentId: string;
  /** 実行環境の初期化時刻 */
  initializedAt: string;
  /** 署名に使ったアクセスキーIDの末尾4文字（環境変数のキーも同じにする） */
  accessKeyIdSuffix: string;
  /** 最後にGETが成功した時刻 */
  lastOkAt: string | null;
  /** 失敗の情報 */
  failure: CheckFailure | null;
};

/**
 * テスト用の記録を作る
 *
 * @param overrides - 変える項目
 * @returns 記録
 */
const buildRecord = (overrides: RecordOverrides): ResultRecord => ({
  id: overrides.id,
  issuerKind: overrides.issuerKind,
  issuedAt: overrides.issuedAt,
  expiresInSeconds: 604_800,
  runtime: {
    environmentId: overrides.environmentId,
    initializedAt: overrides.initializedAt,
    elapsedSeconds: secondsBetween(overrides.initializedAt, overrides.issuedAt),
    invocationCount: 1,
    isColdStart: overrides.initializedAt === overrides.issuedAt,
    accessKeyIdSuffix: overrides.accessKeyIdSuffix,
  },
  signingAccessKeyIdSuffix: overrides.accessKeyIdSuffix,
  check: { lastOkAt: overrides.lastOkAt, failure: overrides.failure },
});

/**
 * テスト用の失敗の情報を作る
 *
 * @param failedAt - 失敗を検知した時刻
 * @returns 失敗の情報
 */
const expiredToken = (failedAt: string): CheckFailure => ({
  failedAt,
  httpStatus: 400,
  errorCode: 'ExpiredToken',
  errorMessage: 'The provided token has expired.',
});

// 常時起動用の実行環境 env-warm（00:00初期化）で3本、コールドスタート用の実行環境 env-cold（01:00初期化）で1本
const WARM_AT_START = buildRecord({
  id: 'warm-1',
  issuerKind: 'warm',
  issuedAt: '2026-09-25T00:00:00.000Z',
  environmentId: 'env-warm',
  initializedAt: '2026-09-25T00:00:00.000Z',
  accessKeyIdSuffix: 'AAAA',
  lastOkAt: '2026-09-25T02:55:00.000Z',
  failure: expiredToken('2026-09-25T03:00:00.000Z'),
});
const WARM_AFTER_30_MINUTES = buildRecord({
  id: 'warm-2',
  issuerKind: 'warm',
  issuedAt: '2026-09-25T00:30:00.000Z',
  environmentId: 'env-warm',
  initializedAt: '2026-09-25T00:00:00.000Z',
  accessKeyIdSuffix: 'AAAA',
  lastOkAt: '2026-09-25T02:55:00.000Z',
  failure: expiredToken('2026-09-25T03:00:00.000Z'),
});
const WARM_AFTER_2_HOURS = buildRecord({
  id: 'warm-3',
  issuerKind: 'warm',
  issuedAt: '2026-09-25T02:00:00.000Z',
  environmentId: 'env-warm',
  initializedAt: '2026-09-25T00:00:00.000Z',
  accessKeyIdSuffix: 'AAAA',
  lastOkAt: '2026-09-25T02:55:00.000Z',
  failure: expiredToken('2026-09-25T03:05:00.000Z'),
});
const COLD_STILL_ALIVE = buildRecord({
  id: 'cold-1',
  issuerKind: 'cold',
  issuedAt: '2026-09-25T01:00:00.000Z',
  environmentId: 'env-cold',
  initializedAt: '2026-09-25T01:00:00.000Z',
  accessKeyIdSuffix: 'BBBB',
  lastOkAt: '2026-09-25T03:05:00.000Z',
  failure: null,
});
const RECORDS = [COLD_STILL_ALIVE, WARM_AFTER_2_HOURS, WARM_AT_START, WARM_AFTER_30_MINUTES];

describe('secondsBetween', () => {
  it('2つの時刻の差を秒（切り捨て）で返す', () => {
    assert.deepStrictEqual(secondsBetween('2026-09-25T00:00:00.000Z', '2026-09-25T01:00:01.999Z'), 3601);
  });
});

describe('formatDuration', () => {
  it('時間と2桁の分で表す', () => {
    assert.deepStrictEqual([formatDuration(0), formatDuration(3900), formatDuration(43_259)], ['0h00m', '1h05m', '12h00m']);
  });
});

describe('formatJst', () => {
  it('日本時間の月日と時刻で表す', () => {
    assert.deepStrictEqual(formatJst('2026-09-25T15:05:00.000Z'), '09/26 00:05');
  });
});

describe('toLastOkAfterSeconds / toFailedAfterSeconds', () => {
  it('失効済みなら両方を返す', () => {
    assert.deepStrictEqual([toLastOkAfterSeconds(WARM_AT_START), toFailedAfterSeconds(WARM_AT_START)], [10_500, 10_800]);
  });

  it('まだ有効なら失敗までの秒数は null', () => {
    assert.deepStrictEqual([toLastOkAfterSeconds(COLD_STILL_ALIVE), toFailedAfterSeconds(COLD_STILL_ALIVE)], [7500, null]);
  });
});

describe('summarizeByCredential', () => {
  it('実行環境 × アクセスキーごとに、初期化から最初に失敗を検知するまでの時間を集計する', () => {
    assert.deepStrictEqual(summarizeByCredential(RECORDS), [
      {
        issuerKind: 'warm',
        environmentId: 'env-warm',
        signingAccessKeyIdSuffix: 'AAAA',
        initializedAt: '2026-09-25T00:00:00.000Z',
        issuedCount: 3,
        firstIssuedAt: '2026-09-25T00:00:00.000Z',
        lastIssuedAt: '2026-09-25T02:00:00.000Z',
        maxElapsedSeconds: 7200,
        failedCount: 3,
        firstFailedAt: '2026-09-25T03:00:00.000Z',
        lastFailedAt: '2026-09-25T03:05:00.000Z',
        failedAfterInitSeconds: 10_800,
        failedAfterFirstIssueSeconds: 10_800,
      },
      {
        issuerKind: 'cold',
        environmentId: 'env-cold',
        signingAccessKeyIdSuffix: 'BBBB',
        initializedAt: '2026-09-25T01:00:00.000Z',
        issuedCount: 1,
        firstIssuedAt: '2026-09-25T01:00:00.000Z',
        lastIssuedAt: '2026-09-25T01:00:00.000Z',
        maxElapsedSeconds: 0,
        failedCount: 0,
        firstFailedAt: null,
        lastFailedAt: null,
        failedAfterInitSeconds: null,
        failedAfterFirstIssueSeconds: null,
      },
    ]);
  });

  it('同じ実行環境でもアクセスキーが変わったら分け、2つ目のキーは最初の発行からの時間も出す', () => {
    const rotated = buildRecord({
      id: 'warm-4',
      issuerKind: 'warm',
      issuedAt: '2026-09-25T02:30:00.000Z',
      environmentId: 'env-warm',
      initializedAt: '2026-09-25T00:00:00.000Z',
      accessKeyIdSuffix: 'CCCC',
      lastOkAt: '2026-09-25T04:25:00.000Z',
      failure: expiredToken('2026-09-25T04:30:00.000Z'),
    });

    assert.deepStrictEqual(
      summarizeByCredential([WARM_AT_START, rotated]).map((summary) => [
        summary.signingAccessKeyIdSuffix,
        summary.issuedCount,
        summary.failedAfterInitSeconds,
        summary.failedAfterFirstIssueSeconds,
      ]),
      [
        ['AAAA', 1, 10_800, 10_800],
        ['CCCC', 1, 16_200, 7200],
      ],
    );
  });
});

describe('summarizeByElapsed', () => {
  it('種類と経過時間の1時間ごとの帯に分け、発行から失敗を検知するまでの最短・最長を集計する', () => {
    assert.deepStrictEqual(summarizeByElapsed(RECORDS), [
      {
        issuerKind: 'cold',
        fromSeconds: 0,
        toSeconds: 3600,
        issuedCount: 1,
        failedCount: 0,
        minFailedAfterSeconds: null,
        maxFailedAfterSeconds: null,
      },
      {
        issuerKind: 'warm',
        fromSeconds: 0,
        toSeconds: 3600,
        issuedCount: 2,
        failedCount: 2,
        minFailedAfterSeconds: 9000,
        maxFailedAfterSeconds: 10_800,
      },
      {
        issuerKind: 'warm',
        fromSeconds: 7200,
        toSeconds: 10_800,
        issuedCount: 1,
        failedCount: 1,
        minFailedAfterSeconds: 3900,
        maxFailedAfterSeconds: 3900,
      },
    ]);
  });
});

describe('summarizeErrors', () => {
  it('失敗の内容ごとに件数を数える', () => {
    const accessDenied = buildRecord({
      id: 'warm-5',
      issuerKind: 'warm',
      issuedAt: '2026-09-25T00:00:00.000Z',
      environmentId: 'env-warm',
      initializedAt: '2026-09-25T00:00:00.000Z',
      accessKeyIdSuffix: 'AAAA',
      lastOkAt: null,
      failure: { failedAt: '2026-09-25T00:05:00.000Z', httpStatus: 403, errorCode: 'AccessDenied', errorMessage: 'Access Denied' },
    });

    assert.deepStrictEqual(summarizeErrors([...RECORDS, accessDenied]), [
      { httpStatus: 400, errorCode: 'ExpiredToken', errorMessage: 'The provided token has expired.', count: 3 },
      { httpStatus: 403, errorCode: 'AccessDenied', errorMessage: 'Access Denied', count: 1 },
    ]);
  });
});
