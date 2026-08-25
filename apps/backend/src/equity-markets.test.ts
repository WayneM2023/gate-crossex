import { describe, expect, it } from 'vitest';
import { marketClassOf, matchesMarketClass } from './equity-markets.js';

describe('equity market classification', () => {
  it('separates Hong Kong, mainland China, and crypto tickers', () => {
    expect(marketClassOf('TENCENT')).toBe('hong_kong');
    expect(marketClassOf('CATL')).toBe('china_a');
    expect(marketClassOf('BTC')).toBe('crypto');
    expect(matchesMarketClass('XIAOMI', 'hong_kong')).toBe(true);
    expect(matchesMarketClass('BOE', 'hong_kong')).toBe(false);
  });
});
