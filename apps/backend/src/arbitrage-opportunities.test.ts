import { describe, expect, it } from 'vitest';
import type { FundingOverviewResponse, LiveMarket, MarketSnapshot, VenueFeeRate } from '@gate-crossex/shared-types';
import { buildArbitrageOpportunities } from './arbitrage-opportunities.js';

const now = Date.parse('2026-08-13T00:00:05.000Z');
const market = (venue: string, bid: string, ask: string, updatedAt = '2026-08-13T00:00:04.500Z'): LiveMarket => ({
  symbol: `${venue}_FUTURE_BTC_USDT`, venue, asset: 'BTC', lastPrice: bid, bidPrice: bid, bidSize: '1', askPrice: ask,
  askSize: '1', open24h: bid, high24h: bid, low24h: bid, volume24h: '1', quoteVolume24h: '1', fundingRate: '0',
  nextFundingAt: '', openInterest: '1', openInterestValue: '1', updatedAt, receivedAt: updatedAt, source: 'gate_crossex_websocket',
});
const snapshot: MarketSnapshot = { connectionState: 'healthy', updatedAt: new Date(now).toISOString(), markets: [
  market('BINANCE', '99.9', '100'), market('GATE', '101', '101.1'),
] };
const funding: FundingOverviewResponse = {
  assets: [{ asset: 'BTC', venues: [
    { venue: 'BINANCE', symbol: 'BINANCE_FUTURE_BTC_USDT', quote: 'USDT', fundingRate: '0', fundingIntervalHours: 8, fundingRate8h: '0.0001', nextFundingAt: null, openInterestValue: null, lastPrice: '100', change24h: null, fetchedAt: new Date(now).toISOString() },
    { venue: 'GATE', symbol: 'GATE_FUTURE_BTC_USDT', quote: 'USDT', fundingRate: '0', fundingIntervalHours: 8, fundingRate8h: '0.0003', nextFundingAt: null, openInterestValue: null, lastPrice: '101', change24h: null, fetchedAt: new Date(now).toISOString() },
  ] }], venueStatus: [], fetchedAt: new Date(now).toISOString(), cacheStatus: 'fresh',
};
const fees: VenueFeeRate[] = [
  { venue: 'BINANCE', spotMakerFee: '0', spotTakerFee: '0', futureMakerFee: '0.0001', futureTakerFee: '0.0002' },
  { venue: 'GATE', spotMakerFee: '0', spotTakerFee: '0', futureMakerFee: '0.0001', futureTakerFee: '0.0002' },
];

describe('buildArbitrageOpportunities', () => {
  it('ranks fee-adjusted executable direction and labels scenario APR', () => {
    const result = buildArbitrageOpportunities(snapshot, funding, fees, { now });
    const top = result.opportunities[0]!;
    expect(top.longVenue).toBe('BINANCE');
    expect(top.shortVenue).toBe('GATE');
    expect(top.entrySpreadBps).toBeCloseTo(100);
    expect(top.fundingSpread8hBps).toBeCloseTo(2);
    expect(top.roundTripFeeBps).toBeCloseTo(8);
    expect(top.netEdge24hBps).toBeCloseTo(98);
    expect(top.executable).toBe(true);
    expect(result.assumptions.annualization).toBe('current_8h_rate_unchanged_scenario');
  });

  it('blocks stale and unsynchronized quotes', () => {
    const stale = { ...snapshot, markets: [market('BINANCE', '99.9', '100', '2026-08-12T23:59:40.000Z'), market('GATE', '101', '101.1')] };
    const result = buildArbitrageOpportunities(stale, funding, fees, { now });
    expect(result.opportunities[0]!.blockers).toEqual(expect.arrayContaining(['stale_quote', 'quote_skew']));
    expect(result.opportunities[0]!.executable).toBe(false);
  });

  it('does not treat a null funding rate as zero', () => {
    const missing = structuredClone(funding);
    missing.assets[0]!.venues[0]!.fundingRate8h = null;
    const result = buildArbitrageOpportunities(snapshot, missing, fees, { now });
    expect(result.opportunities.every((row) => row.blockers.includes('funding_unavailable'))).toBe(true);
  });
});
