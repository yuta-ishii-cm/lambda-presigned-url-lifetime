/**
 * 必須の環境変数を読む
 *
 * @param name - 環境変数名
 * @returns 環境変数の値
 */
export const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`環境変数 ${name} が設定されていません`);
  }
  return value;
};
