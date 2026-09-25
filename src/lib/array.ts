/**
 * 配列を指定した件数ずつに分ける
 *
 * @param items - 分ける配列
 * @param size - 1つあたりの件数
 * @returns 分けた配列の配列
 */
export const chunk = <T>(items: readonly T[], size: number): T[][] => {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`件数は1以上の整数で指定してください: ${size}`);
  }
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
};
