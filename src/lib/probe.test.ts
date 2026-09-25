import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyProbeOutcome, classifyProbeResponse, parseS3Error } from './probe.ts';
import type { UrlRecord } from './record.ts';

const EXPIRED_TOKEN_BODY = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<Error><Code>ExpiredToken</Code><Message>The provided token has expired.</Message>',
  '<Token-0>secret-session-token</Token-0><RequestId>REQ</RequestId><HostId>HOST</HostId></Error>',
].join('\n');

const RECORD: UrlRecord = {
  id: 'record-1',
  issuerKind: 'cold',
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
  check: { lastOkAt: '2026-09-25T00:05:00.000Z', failure: null },
  url: 'https://example.com/probe.txt',
};

describe('parseS3Error', () => {
  it('コードとメッセージだけを取り出し、トークンは含めない', () => {
    assert.deepStrictEqual(parseS3Error(EXPIRED_TOKEN_BODY), {
      code: 'ExpiredToken',
      message: 'The provided token has expired.',
    });
  });

  it('XMLでなければ null を返す', () => {
    assert.deepStrictEqual(parseS3Error('Bad Request'), { code: null, message: null });
  });
});

describe('classifyProbeResponse', () => {
  it('2xx は成功', () => {
    assert.deepStrictEqual(classifyProbeResponse(200, 'probe'), { kind: 'ok' });
  });

  it('4xx はURLが使えなくなったものとして扱う', () => {
    assert.deepStrictEqual(classifyProbeResponse(400, EXPIRED_TOKEN_BODY), {
      kind: 'failed',
      httpStatus: 400,
      errorCode: 'ExpiredToken',
      errorMessage: 'The provided token has expired.',
    });
  });

  it('5xx は一時的な失敗として扱う', () => {
    assert.deepStrictEqual(classifyProbeResponse(503, '<Error><Code>SlowDown</Code></Error>'), {
      kind: 'transient',
      reason: 'HTTP 503',
    });
  });
});

describe('applyProbeOutcome', () => {
  const probedAt = new Date('2026-09-25T00:10:00.000Z');

  it('成功なら最後に成功した時刻を更新する', () => {
    assert.deepStrictEqual(applyProbeOutcome(RECORD, { kind: 'ok' }, probedAt), {
      ...RECORD,
      check: { lastOkAt: '2026-09-25T00:10:00.000Z', failure: null },
    });
  });

  it('失敗なら最後に成功した時刻を残したまま失敗の情報を記録する', () => {
    assert.deepStrictEqual(
      applyProbeOutcome(
        RECORD,
        { kind: 'failed', httpStatus: 400, errorCode: 'ExpiredToken', errorMessage: 'The provided token has expired.' },
        probedAt,
      ),
      {
        ...RECORD,
        check: {
          lastOkAt: '2026-09-25T00:05:00.000Z',
          failure: {
            failedAt: '2026-09-25T00:10:00.000Z',
            httpStatus: 400,
            errorCode: 'ExpiredToken',
            errorMessage: 'The provided token has expired.',
          },
        },
      },
    );
  });

  it('一時的な失敗なら記録を変えない', () => {
    assert.deepStrictEqual(applyProbeOutcome(RECORD, { kind: 'transient', reason: 'TimeoutError' }, probedAt), RECORD);
  });
});
