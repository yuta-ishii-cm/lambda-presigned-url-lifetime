import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type ResultRecord,
  type UrlRecord,
  dedupeRecords,
  omitUrl,
  parseIssuerKind,
  toFailedRecordKey,
  toLiveRecordKey,
} from './record.ts';

const RECORD: UrlRecord = {
  id: 'record-1',
  issuerKind: 'warm',
  issuedAt: '2026-09-25T00:00:00.000Z',
  expiresInSeconds: 604_800,
  runtime: {
    environmentId: 'env-1',
    initializedAt: '2026-09-25T00:00:00.000Z',
    elapsedSeconds: 0,
    invocationCount: 1,
    isColdStart: true,
    accessKeyIdSuffix: 'ABCD',
  },
  signingAccessKeyIdSuffix: 'ABCD',
  check: { lastOkAt: null, failure: null },
  url: 'https://example.com/probe.txt?X-Amz-Security-Token=secret',
};

describe('toLiveRecordKey / toFailedRecordKey', () => {
  it('確認中と失敗済みでプレフィックスを分ける', () => {
    assert.deepStrictEqual(
      [toLiveRecordKey('record-1'), toFailedRecordKey('record-1')],
      ['records/live/record-1.json', 'records/failed/record-1.json'],
    );
  });
});

describe('parseIssuerKind', () => {
  it('warm と cold を受け付ける', () => {
    assert.deepStrictEqual([parseIssuerKind('warm'), parseIssuerKind('cold')], ['warm', 'cold']);
  });

  it('それ以外は例外を投げる', () => {
    assert.throws(() => parseIssuerKind('hot'));
    assert.throws(() => parseIssuerKind(undefined));
  });
});

describe('omitUrl', () => {
  it('URL以外の項目だけを残す', () => {
    const { url: _url, ...expected } = RECORD;

    assert.deepStrictEqual(omitUrl(RECORD), expected);
  });

  it('URLは結果に含まれない', () => {
    assert.deepStrictEqual(JSON.stringify(omitUrl(RECORD)).includes('secret'), false);
  });
});

describe('dedupeRecords', () => {
  const live: ResultRecord = { ...omitUrl(RECORD), check: { lastOkAt: '2026-09-25T00:05:00.000Z', failure: null } };
  const failed: ResultRecord = {
    ...live,
    check: {
      lastOkAt: '2026-09-25T00:05:00.000Z',
      failure: { failedAt: '2026-09-25T00:10:00.000Z', httpStatus: 400, errorCode: 'ExpiredToken', errorMessage: null },
    },
  };
  const other: ResultRecord = { ...live, id: 'record-2' };

  it('同じIDなら失敗の情報を持つ方を残す（失敗済みが後に来る場合）', () => {
    assert.deepStrictEqual(dedupeRecords([live, other, failed]), [failed, other]);
  });

  it('同じIDなら失敗の情報を持つ方を残す（失敗済みが先に来る場合）', () => {
    assert.deepStrictEqual(dedupeRecords([failed, live, other]), [failed, other]);
  });
});
