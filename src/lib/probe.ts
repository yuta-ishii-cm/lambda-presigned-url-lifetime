import type { UrlRecord } from './record.ts';

/** HTTPステータスの区切り */
const HTTP_STATUS = {
  successFrom: 200,
  clientErrorFrom: 400,
  serverErrorFrom: 500,
} as const;

/** GETが成功した */
export type ProbeOk = {
  /** 結果の種類 */
  kind: 'ok';
};

/** GETが4xxで失敗した（認証情報の失効など、URLがもう使えない） */
export type ProbeFailed = {
  /** 結果の種類 */
  kind: 'failed';
  /** HTTPステータス */
  httpStatus: number;
  /** S3のエラーコード */
  errorCode: string | null;
  /** S3のエラーメッセージ */
  errorMessage: string | null;
};

/** 5xxや通信エラーなど、URLの有効性とは関係なく失敗した */
export type ProbeTransient = {
  /** 結果の種類 */
  kind: 'transient';
  /** 失敗の理由 */
  reason: string;
};

/** 署名付きURLをGETした結果 */
export type ProbeOutcome = ProbeOk | ProbeFailed | ProbeTransient;

/** S3のエラーレスポンスから取り出した値 */
export type S3ErrorDetail = {
  /** エラーコード */
  code: string | null;
  /** エラーメッセージ */
  message: string | null;
};

/**
 * XMLから1つの要素の中身を取り出す
 *
 * @param xml - XML文字列
 * @param tagName - 要素名
 * @returns 要素の中身。見つからなければ `null`
 */
const extractElement = (xml: string, tagName: string): string | null =>
  new RegExp(`<${tagName}>([^<]*)</${tagName}>`).exec(xml)?.[1] ?? null;

/**
 * S3のエラーレスポンスからコードとメッセージだけを取り出す
 *
 * @description `ExpiredToken` のレスポンスには `<Token-0>` としてセッショントークンが入っているため、
 * 本文をそのまま保存・ログ出力せず、必要な要素だけを取り出す
 * @param body - レスポンス本文
 * @returns エラーコードとメッセージ
 */
export const parseS3Error = (body: string): S3ErrorDetail => ({
  code: extractElement(body, 'Code'),
  message: extractElement(body, 'Message'),
});

/**
 * GETのレスポンスを分類する
 *
 * @param httpStatus - HTTPステータス
 * @param body - レスポンス本文
 * @returns 分類した結果
 */
export const classifyProbeResponse = (httpStatus: number, body: string): ProbeOutcome => {
  if (httpStatus >= HTTP_STATUS.successFrom && httpStatus < HTTP_STATUS.clientErrorFrom) {
    return { kind: 'ok' };
  }
  if (httpStatus >= HTTP_STATUS.clientErrorFrom && httpStatus < HTTP_STATUS.serverErrorFrom) {
    const { code, message } = parseS3Error(body);
    return { kind: 'failed', httpStatus, errorCode: code, errorMessage: message };
  }
  return { kind: 'transient', reason: `HTTP ${httpStatus}` };
};

/**
 * GETの結果を記録に反映する
 *
 * @param record - 確認前の記録
 * @param outcome - GETの結果
 * @param probedAt - GETした時刻
 * @returns 確認後の記録。`transient` のときは元の記録のまま
 */
export const applyProbeOutcome = (record: UrlRecord, outcome: ProbeOutcome, probedAt: Date): UrlRecord => {
  switch (outcome.kind) {
    case 'ok':
      return { ...record, check: { ...record.check, lastOkAt: probedAt.toISOString() } };
    case 'failed':
      return {
        ...record,
        check: {
          ...record.check,
          failure: {
            failedAt: probedAt.toISOString(),
            httpStatus: outcome.httpStatus,
            errorCode: outcome.errorCode,
            errorMessage: outcome.errorMessage,
          },
        },
      };
    case 'transient':
      return record;
  }
};
