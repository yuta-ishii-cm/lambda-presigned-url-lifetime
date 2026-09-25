/** アクセスキーIDのうち記録する末尾の文字数 */
const ACCESS_KEY_ID_SUFFIX_LENGTH = 4;

/** 1秒あたりのミリ秒数 */
const MILLISECONDS_PER_SECOND = 1000;

/** 実行環境ごとに1つだけ持つ状態 */
export type EnvironmentState = {
  /** 実行環境ID（モジュールのトップレベルで1回だけ作るUUID） */
  readonly environmentId: string;
  /** 実行環境の初期化時刻（モジュールのトップレベルで記録する時刻） */
  readonly initializedAt: Date;
  /** この実行環境での呼び出し回数 */
  invocationCount: number;
};

/** URLを発行した時点の実行環境の情報 */
export type RuntimeInfo = {
  /** 実行環境ID */
  environmentId: string;
  /** 実行環境の初期化時刻（ISO 8601） */
  initializedAt: string;
  /** 初期化から発行までの経過秒数 */
  elapsedSeconds: number;
  /** この実行環境での呼び出し回数（1始まり） */
  invocationCount: number;
  /** コールドスタートだったか（実行環境で最初の呼び出しか） */
  isColdStart: boolean;
  /** 環境変数 `AWS_ACCESS_KEY_ID` の末尾4文字 */
  accessKeyIdSuffix: string;
};

/** collectRuntimeInfo の引数 */
export type CollectRuntimeInfoParams = {
  /** 実行環境の状態（呼び出し回数は数え終えたもの） */
  state: EnvironmentState;
  /** 呼び出された時刻 */
  invokedAt: Date;
  /** `AWS_ACCESS_KEY_ID` の値 */
  accessKeyId: string | undefined;
};

/**
 * 実行環境の状態を作る
 *
 * @param environmentId - 実行環境ID
 * @param initializedAt - 初期化時刻
 * @returns 呼び出し回数が0の状態
 */
export const createEnvironmentState = (environmentId: string, initializedAt: Date): EnvironmentState => ({
  environmentId,
  initializedAt,
  invocationCount: 0,
});

/**
 * アクセスキーIDの末尾4文字を取り出す
 *
 * @description 認証情報が更新されたかを見分けるためだけに使う。全体は記録しない
 * @param accessKeyId - アクセスキーID
 * @returns アクセスキーIDの末尾4文字
 */
export const toAccessKeyIdSuffix = (accessKeyId: string | undefined): string => {
  if (!accessKeyId || accessKeyId.length < ACCESS_KEY_ID_SUFFIX_LENGTH) {
    throw new Error('AWS_ACCESS_KEY_ID が取得できません');
  }
  return accessKeyId.slice(-ACCESS_KEY_ID_SUFFIX_LENGTH);
};

/**
 * 署名付きURLの `X-Amz-Credential` から、署名に使ったアクセスキーIDの末尾4文字を取り出す
 *
 * @description SDKは有効期限のない認証情報をキャッシュし続けるため、環境変数が変わっても署名に使うキーは変わらないことがある。
 * URLの失効を認証情報と結びつけるには、実際に署名したキーを見る
 * @param url - 署名付きURL
 * @returns アクセスキーIDの末尾4文字
 */
export const toSigningAccessKeyIdSuffix = (url: string): string => {
  const credential = new URL(url).searchParams.get('X-Amz-Credential');
  return toAccessKeyIdSuffix(credential?.split('/')[0]);
};

/**
 * URLを発行した時点の実行環境の情報をまとめる
 *
 * @param params - 実行環境の状態・呼び出し時刻・アクセスキーID
 * @returns 実行環境の情報
 */
export const collectRuntimeInfo = ({ state, invokedAt, accessKeyId }: CollectRuntimeInfoParams): RuntimeInfo => ({
  environmentId: state.environmentId,
  initializedAt: state.initializedAt.toISOString(),
  elapsedSeconds: Math.floor((invokedAt.getTime() - state.initializedAt.getTime()) / MILLISECONDS_PER_SECOND),
  invocationCount: state.invocationCount,
  isColdStart: state.invocationCount === 1,
  accessKeyIdSuffix: toAccessKeyIdSuffix(accessKeyId),
});
