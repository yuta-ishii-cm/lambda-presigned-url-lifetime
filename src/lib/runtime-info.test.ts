import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  collectRuntimeInfo,
  createEnvironmentState,
  toAccessKeyIdSuffix,
  toSigningAccessKeyIdSuffix,
} from './runtime-info.ts';

const INITIALIZED_AT = new Date('2026-09-25T00:00:00.000Z');

describe('createEnvironmentState', () => {
  it('呼び出し回数0の状態を作る', () => {
    assert.deepStrictEqual(createEnvironmentState('env-1', INITIALIZED_AT), {
      environmentId: 'env-1',
      initializedAt: INITIALIZED_AT,
      invocationCount: 0,
    });
  });
});

describe('toAccessKeyIdSuffix', () => {
  it('末尾4文字だけを返す', () => {
    assert.deepStrictEqual(toAccessKeyIdSuffix('ASIAEXAMPLEKEY1234'), '1234');
  });

  it('未設定なら例外を投げる', () => {
    assert.throws(() => toAccessKeyIdSuffix(undefined));
  });

  it('4文字に満たなければ例外を投げる', () => {
    assert.throws(() => toAccessKeyIdSuffix('ABC'));
  });
});

describe('toSigningAccessKeyIdSuffix', () => {
  it('X-Amz-Credential のアクセスキーIDから末尾4文字を取り出す', () => {
    const url =
      'https://bucket.s3.ap-northeast-1.amazonaws.com/probe.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
      '&X-Amz-Credential=ASIAEXAMPLEKEYWXYZ%2F20260925%2Fap-northeast-1%2Fs3%2Faws4_request&X-Amz-Expires=604800';

    assert.deepStrictEqual(toSigningAccessKeyIdSuffix(url), 'WXYZ');
  });

  it('X-Amz-Credential がなければ例外を投げる', () => {
    assert.throws(() => toSigningAccessKeyIdSuffix('https://bucket.s3.ap-northeast-1.amazonaws.com/probe.txt'));
  });
});

describe('collectRuntimeInfo', () => {
  it('実行環境で最初の呼び出しはコールドスタートとして記録する', () => {
    const state = { ...createEnvironmentState('env-1', INITIALIZED_AT), invocationCount: 1 };

    assert.deepStrictEqual(
      collectRuntimeInfo({
        state,
        invokedAt: new Date('2026-09-25T00:00:00.250Z'),
        accessKeyId: 'ASIAEXAMPLEKEYABCD',
      }),
      {
        environmentId: 'env-1',
        initializedAt: '2026-09-25T00:00:00.000Z',
        elapsedSeconds: 0,
        invocationCount: 1,
        isColdStart: true,
        accessKeyIdSuffix: 'ABCD',
      },
    );
  });

  it('2回目以降の呼び出しは初期化からの経過秒数（切り捨て）を記録する', () => {
    const state = { ...createEnvironmentState('env-1', INITIALIZED_AT), invocationCount: 13 };

    assert.deepStrictEqual(
      collectRuntimeInfo({
        state,
        invokedAt: new Date('2026-09-25T01:00:05.999Z'),
        accessKeyId: 'ASIAEXAMPLEKEYABCD',
      }),
      {
        environmentId: 'env-1',
        initializedAt: '2026-09-25T00:00:00.000Z',
        elapsedSeconds: 3605,
        invocationCount: 13,
        isColdStart: false,
        accessKeyIdSuffix: 'ABCD',
      },
    );
  });
});
