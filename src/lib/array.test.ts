import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chunk } from './array.ts';

describe('chunk', () => {
  it('指定した件数ずつに分け、端数は最後にまとめる', () => {
    assert.deepStrictEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  });

  it('空配列なら空配列を返す', () => {
    assert.deepStrictEqual(chunk([], 3), []);
  });

  it('件数が1未満なら例外を投げる', () => {
    assert.throws(() => chunk([1], 0));
  });
});
