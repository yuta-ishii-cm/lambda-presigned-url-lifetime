import type { IssuerKind, RecordSnapshot, ResultRecord } from './record.ts';

/** 1秒あたりのミリ秒数 */
const MILLISECONDS_PER_SECOND = 1000;

/** 1分あたりの秒数 */
const SECONDS_PER_MINUTE = 60;

/** 1時間あたりの秒数 */
const SECONDS_PER_HOUR = 3600;

/** 経過時間の帯の幅（秒） */
const ELAPSED_BUCKET_SECONDS = SECONDS_PER_HOUR;

/** 表に出す実行環境IDの文字数 */
const ENVIRONMENT_ID_DISPLAY_LENGTH = 8;

/** 分を表示するときの桁数 */
const MINUTES_DIGITS = 2;

/** 表に出す発行Lambdaの種類の名前 */
const ISSUER_KIND_LABELS: Record<IssuerKind, string> = {
  warm: '常時起動',
  cold: 'コールド',
};

/** 日本時間で月日と時刻を表示するフォーマッタ */
const JST_FORMATTER = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** 認証情報（実行環境 × アクセスキー）ごとの集計 */
export type CredentialSummary = {
  /** 発行Lambdaの種類 */
  issuerKind: IssuerKind;
  /** 実行環境ID */
  environmentId: string;
  /** 署名に使ったアクセスキーIDの末尾4文字 */
  signingAccessKeyIdSuffix: string;
  /** 実行環境の初期化時刻（ISO 8601） */
  initializedAt: string;
  /** 発行したURLの数 */
  issuedCount: number;
  /** 最初に発行した時刻（ISO 8601） */
  firstIssuedAt: string;
  /** 最後に発行した時刻（ISO 8601） */
  lastIssuedAt: string;
  /** 最後に発行した時点での実行環境の経過秒数 */
  maxElapsedSeconds: number;
  /** 失敗を検知したURLの数 */
  failedCount: number;
  /** 最初に失敗を検知した時刻（ISO 8601）。まだなければ `null` */
  firstFailedAt: string | null;
  /** 最後に失敗を検知した時刻（ISO 8601）。まだなければ `null` */
  lastFailedAt: string | null;
  /**
   * 実行環境の初期化から最初に失敗を検知するまでの秒数。まだなければ `null`
   *
   * @description 実行環境の途中でキーが変わった場合、2つ目以降のキーではキーの寿命より長く出る
   */
  failedAfterInitSeconds: number | null;
  /** このキーで最初に発行してから最初に失敗を検知するまでの秒数（キーの寿命の下限）。まだなければ `null` */
  failedAfterFirstIssueSeconds: number | null;
};

/** 実行環境の経過時間の帯ごとの集計 */
export type ElapsedBucketSummary = {
  /** 発行Lambdaの種類 */
  issuerKind: IssuerKind;
  /** 帯の始まり（秒、この値を含む） */
  fromSeconds: number;
  /** 帯の終わり（秒、この値を含まない） */
  toSeconds: number;
  /** 発行したURLの数 */
  issuedCount: number;
  /** 失敗を検知したURLの数 */
  failedCount: number;
  /** 失敗を検知したURLのうち、発行から失敗を検知するまでの最短の秒数 */
  minFailedAfterSeconds: number | null;
  /** 失敗を検知したURLのうち、発行から失敗を検知するまでの最長の秒数 */
  maxFailedAfterSeconds: number | null;
};

/** 失敗の内容ごとの件数 */
export type ErrorSummary = {
  /** HTTPステータス */
  httpStatus: number;
  /** S3のエラーコード */
  errorCode: string | null;
  /** S3のエラーメッセージ */
  errorMessage: string | null;
  /** 件数 */
  count: number;
};

/**
 * 2つの時刻の差を秒で返す
 *
 * @param from - 始まりの時刻（ISO 8601）
 * @param to - 終わりの時刻（ISO 8601）
 * @returns 差の秒数（切り捨て）
 */
export const secondsBetween = (from: string, to: string): number =>
  Math.floor((Date.parse(to) - Date.parse(from)) / MILLISECONDS_PER_SECOND);

/**
 * 秒数を「1h05m」の形にする
 *
 * @param seconds - 秒数
 * @returns 時間と分の表記
 */
export const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  return `${hours}h${String(minutes).padStart(MINUTES_DIGITS, '0')}m`;
};

/**
 * 時刻を日本時間の「09/26 03:05」の形にする
 *
 * @param iso - 時刻（ISO 8601）
 * @returns 日本時間の月日と時刻
 */
export const formatJst = (iso: string): string => JST_FORMATTER.format(new Date(iso));

/**
 * 発行から最後にGETが成功するまでの秒数を返す
 *
 * @param record - 記録
 * @returns 秒数。一度も成功していなければ `null`
 */
export const toLastOkAfterSeconds = (record: ResultRecord): number | null =>
  record.check.lastOkAt ? secondsBetween(record.issuedAt, record.check.lastOkAt) : null;

/**
 * 発行から失敗を検知するまでの秒数を返す
 *
 * @param record - 記録
 * @returns 秒数。まだ失敗していなければ `null`
 */
export const toFailedAfterSeconds = (record: ResultRecord): number | null =>
  record.check.failure ? secondsBetween(record.issuedAt, record.check.failure.failedAt) : null;

/**
 * 配列をキーごとにまとめる
 *
 * @param items - まとめる配列
 * @param toKey - キーを作る関数
 * @returns キーごとの配列（最初に現れた順）
 */
const groupBy = <T>(items: readonly T[], toKey: (item: T) => string): T[][] => {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = toKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()];
};

/**
 * 時刻の配列から最も早い・遅い時刻を返す
 *
 * @param isoList - 時刻（ISO 8601）の配列
 * @returns 最も早い時刻と最も遅い時刻。空なら `null`
 */
const toTimeRange = (isoList: readonly string[]): { first: string; last: string } | null => {
  if (!isoList.length) {
    return null;
  }
  const sorted = [...isoList].sort((a, b) => Date.parse(a) - Date.parse(b));
  return { first: sorted[0], last: sorted[sorted.length - 1] };
};

/**
 * 記録を発行時刻の順に並べる
 *
 * @param records - 記録
 * @returns 発行時刻の早い順に並べた新しい配列
 */
const sortByIssuedAt = (records: readonly ResultRecord[]): ResultRecord[] =>
  [...records].sort((a, b) => Date.parse(a.issuedAt) - Date.parse(b.issuedAt));

/**
 * 認証情報（実行環境 × 署名に使ったアクセスキー）ごとに集計する
 *
 * @description 同じ認証情報で署名したURLは同時に失効するはずなので、失効までの時間が認証情報の寿命の目安になる
 * @param records - 記録
 * @returns 実行環境の初期化時刻の順に並べた集計
 */
export const summarizeByCredential = (records: readonly ResultRecord[]): CredentialSummary[] =>
  groupBy(sortByIssuedAt(records), (record) => `${record.runtime.environmentId}/${record.signingAccessKeyIdSuffix}`)
    .map((group): CredentialSummary => {
      const [first] = group;
      const last = group[group.length - 1];
      const failedAtRange = toTimeRange(group.flatMap((record) => (record.check.failure ? [record.check.failure.failedAt] : [])));
      return {
        issuerKind: first.issuerKind,
        environmentId: first.runtime.environmentId,
        signingAccessKeyIdSuffix: first.signingAccessKeyIdSuffix,
        initializedAt: first.runtime.initializedAt,
        issuedCount: group.length,
        firstIssuedAt: first.issuedAt,
        lastIssuedAt: last.issuedAt,
        maxElapsedSeconds: last.runtime.elapsedSeconds,
        failedCount: group.filter((record) => record.check.failure).length,
        firstFailedAt: failedAtRange?.first ?? null,
        lastFailedAt: failedAtRange?.last ?? null,
        failedAfterInitSeconds: failedAtRange ? secondsBetween(first.runtime.initializedAt, failedAtRange.first) : null,
        failedAfterFirstIssueSeconds: failedAtRange ? secondsBetween(first.issuedAt, failedAtRange.first) : null,
      };
    })
    .sort((a, b) => Date.parse(a.initializedAt) - Date.parse(b.initializedAt));

/**
 * 発行Lambdaの種類と実行環境の経過時間の帯ごとに、URLがもった時間を集計する
 *
 * @param records - 記録
 * @returns 種類・帯の順に並べた集計
 */
export const summarizeByElapsed = (records: readonly ResultRecord[]): ElapsedBucketSummary[] =>
  groupBy(records, (record) => `${record.issuerKind}/${Math.floor(record.runtime.elapsedSeconds / ELAPSED_BUCKET_SECONDS)}`)
    .map((group): ElapsedBucketSummary => {
      const [first] = group;
      const fromSeconds = Math.floor(first.runtime.elapsedSeconds / ELAPSED_BUCKET_SECONDS) * ELAPSED_BUCKET_SECONDS;
      const failedAfterList = group.flatMap((record) => toFailedAfterSeconds(record) ?? []);
      return {
        issuerKind: first.issuerKind,
        fromSeconds,
        toSeconds: fromSeconds + ELAPSED_BUCKET_SECONDS,
        issuedCount: group.length,
        failedCount: failedAfterList.length,
        minFailedAfterSeconds: failedAfterList.length ? Math.min(...failedAfterList) : null,
        maxFailedAfterSeconds: failedAfterList.length ? Math.max(...failedAfterList) : null,
      };
    })
    .sort((a, b) => a.issuerKind.localeCompare(b.issuerKind) || a.fromSeconds - b.fromSeconds);

/**
 * 失敗の内容（HTTPステータス・コード・メッセージ）ごとに数える
 *
 * @param records - 記録
 * @returns 件数の多い順に並べた集計
 */
export const summarizeErrors = (records: readonly ResultRecord[]): ErrorSummary[] =>
  groupBy(
    records.flatMap((record) => (record.check.failure ? [record.check.failure] : [])),
    (failure) => JSON.stringify([failure.httpStatus, failure.errorCode, failure.errorMessage]),
  )
    .map(([first, ...rest]) => ({
      httpStatus: first.httpStatus,
      errorCode: first.errorCode,
      errorMessage: first.errorMessage,
      count: rest.length + 1,
    }))
    .sort((a, b) => b.count - a.count);

/**
 * 表のセルに入れる文字列を整える
 *
 * @param value - セルの値
 * @returns `|` をエスケープした文字列。値がなければ `-`
 */
const toCell = (value: string | number | null): string => (value === null ? '-' : String(value).replaceAll('|', '\\|'));

/**
 * Markdownの表を作る
 *
 * @param headers - 見出し
 * @param rows - 行
 * @returns Markdownの表
 */
const renderTable = (headers: readonly string[], rows: readonly (readonly (string | number | null)[])[]): string =>
  [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(toCell).join(' | ')} |`),
  ].join('\n');

/**
 * 時刻があれば日本時間にする
 *
 * @param iso - 時刻（ISO 8601）
 * @returns 日本時間の表記。なければ `null`
 */
const formatJstOrNull = (iso: string | null): string | null => (iso ? formatJst(iso) : null);

/**
 * 秒数があれば「1h05m」の形にする
 *
 * @param seconds - 秒数
 * @returns 時間と分の表記。なければ `null`
 */
const formatDurationOrNull = (seconds: number | null): string | null => (seconds === null ? null : formatDuration(seconds));

/**
 * URLがもった時間を表示用にする
 *
 * @param record - 記録
 * @returns 失効済みなら「最後の成功〜失敗の検知」、まだ有効なら「≥ 最後の成功」
 */
const formatLifetime = (record: ResultRecord): string | null => {
  const lastOk = formatDurationOrNull(toLastOkAfterSeconds(record));
  const failedAfter = toFailedAfterSeconds(record);
  if (failedAfter === null) {
    return lastOk ? `≥ ${lastOk}` : null;
  }
  return `${lastOk ?? '-'}〜${formatDuration(failedAfter)}`;
};

/**
 * 集計結果（認証情報ごと・経過時間の帯ごと・失敗の内容）をMarkdownにする
 *
 * @param snapshot - バケットから取り出した記録
 * @returns Markdown
 */
export const renderSummaryMarkdown = (snapshot: RecordSnapshot): string => {
  const { records } = snapshot;
  const failedCount = records.filter((record) => record.check.failure).length;
  const keyMismatchCount = records.filter((record) => record.runtime.accessKeyIdSuffix !== record.signingAccessKeyIdSuffix).length;

  const credentialTable = renderTable(
    [
      '種別',
      '実行環境',
      'キー末尾',
      '初期化',
      '発行数',
      '最初の発行',
      '最後の発行',
      '最後の発行時の経過',
      '失効数',
      '失効を検知',
      '初期化→失効',
      '最初の発行→失効',
    ],
    summarizeByCredential(records).map((summary) => [
      ISSUER_KIND_LABELS[summary.issuerKind],
      summary.environmentId.slice(0, ENVIRONMENT_ID_DISPLAY_LENGTH),
      summary.signingAccessKeyIdSuffix,
      formatJst(summary.initializedAt),
      summary.issuedCount,
      formatJst(summary.firstIssuedAt),
      formatJst(summary.lastIssuedAt),
      formatDuration(summary.maxElapsedSeconds),
      summary.failedCount,
      summary.firstFailedAt === summary.lastFailedAt
        ? formatJstOrNull(summary.firstFailedAt)
        : `${formatJstOrNull(summary.firstFailedAt)}〜${formatJstOrNull(summary.lastFailedAt)}`,
      formatDurationOrNull(summary.failedAfterInitSeconds),
      formatDurationOrNull(summary.failedAfterFirstIssueSeconds),
    ]),
  );

  const elapsedTable = renderTable(
    ['種別', '発行時の経過', '発行数', '失効数', 'もった時間（最短）', 'もった時間（最長）'],
    summarizeByElapsed(records).map((summary) => [
      ISSUER_KIND_LABELS[summary.issuerKind],
      `${formatDuration(summary.fromSeconds)}〜`,
      summary.issuedCount,
      summary.failedCount,
      formatDurationOrNull(summary.minFailedAfterSeconds),
      formatDurationOrNull(summary.maxFailedAfterSeconds),
    ]),
  );

  const errorTable = renderTable(
    ['HTTP', 'コード', 'メッセージ', '件数'],
    summarizeErrors(records).map((summary) => [summary.httpStatus, summary.errorCode, summary.errorMessage, summary.count]),
  );

  return [
    '# 計測結果の集計',
    '',
    `- 取得時刻: ${formatJst(snapshot.fetchedAt)}（日本時間）`,
    `- URL数: ${records.length}（失効 ${failedCount} / まだ有効 ${records.length - failedCount}）`,
    `- 環境変数と署名でアクセスキーが食い違った記録: ${keyMismatchCount}件`,
    '- 失効の検知は5分おきのため、時刻の精度は5分',
    '',
    '## 認証情報ごと（実行環境 × 署名に使ったアクセスキー）',
    '',
    '「初期化→失効」は実行環境の初期化から数えた時間。実行環境の途中でキーが変わった場合、2つ目以降のキーは「最初の発行→失効」を見る。',
    '',
    credentialTable,
    '',
    '## 実行環境の経過時間とURLがもった時間',
    '',
    'もった時間は、発行から失敗を検知するまで。',
    '',
    elapsedTable,
    '',
    '## 失敗の内容',
    '',
    errorTable,
    '',
  ].join('\n');
};

/**
 * URLごとの一覧をMarkdownにする
 *
 * @param records - 記録
 * @returns Markdown
 */
export const renderUrlTableMarkdown = (records: readonly ResultRecord[]): string =>
  [
    '## URLごと',
    '',
    'もった時間は「最後にGETが成功するまで〜失敗を検知するまで」。まだ有効なものは「≥ 最後にGETが成功するまで」。',
    '',
    renderTable(
      ['発行', '種別', '実行環境', '呼び出し', 'コールド', '経過', 'キー末尾', '最後の成功', '失効を検知', 'もった時間', 'エラー'],
      sortByIssuedAt(records).map((record) => [
        formatJst(record.issuedAt),
        ISSUER_KIND_LABELS[record.issuerKind],
        record.runtime.environmentId.slice(0, ENVIRONMENT_ID_DISPLAY_LENGTH),
        record.runtime.invocationCount,
        record.runtime.isColdStart ? 'yes' : 'no',
        formatDuration(record.runtime.elapsedSeconds),
        record.signingAccessKeyIdSuffix,
        formatJstOrNull(record.check.lastOkAt),
        formatJstOrNull(record.check.failure?.failedAt ?? null),
        formatLifetime(record),
        record.check.failure?.errorCode ?? null,
      ]),
    ),
    '',
  ].join('\n');
