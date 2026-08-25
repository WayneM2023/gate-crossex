export type ArbitrageMarketClass = 'all' | 'crypto' | 'hong_kong' | 'china_a';

/** Gate CrossEx native equity-perp tickers. Kept explicit so crypto symbols are never guessed as stocks. */
export const HONG_KONG_EQUITY_ASSETS = new Set([
  'AKESO', 'ANTA', 'BABA', 'BYD', 'CMOC', 'KUAISHOU', 'MEITUAN', 'SMIC', 'TENCENT', 'XIAOMI',
]);

export const CHINA_A_EQUITY_ASSETS = new Set([
  'AMEC', 'BLUEFOCUS', 'BOE', 'CAMBRICON', 'CATL', 'CITIC',
]);

export function marketClassOf(asset: string): Exclude<ArbitrageMarketClass, 'all'> {
  if (HONG_KONG_EQUITY_ASSETS.has(asset)) return 'hong_kong';
  if (CHINA_A_EQUITY_ASSETS.has(asset)) return 'china_a';
  return 'crypto';
}

export function matchesMarketClass(asset: string, marketClass: ArbitrageMarketClass): boolean {
  return marketClass === 'all' || marketClassOf(asset) === marketClass;
}
