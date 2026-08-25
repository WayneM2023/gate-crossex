import type {
  ArbitrageOpportunitiesResponse,
  FundingOverviewResponse,
  LiveMarket,
  MarketSnapshot,
  VenueFeeRate,
} from '@gate-crossex/shared-types';
import { marketClassOf, matchesMarketClass, type ArbitrageMarketClass } from './equity-markets.js';

export interface ArbitrageOpportunityOptions {
  now?: number;
  notionalPerLegUsd?: number;
  leverage?: number;
  holdingHours?: number;
  maxQuoteAgeMs?: number;
  maxQuoteSkewMs?: number;
  limit?: number;
  marketClass?: ArbitrageMarketClass;
}

const finitePositive = (value: string): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

function takerFee(fees: readonly VenueFeeRate[], market: LiveMarket): number | null {
  const venueFee = fees.find((fee) => fee.venue.toUpperCase() === market.venue.toUpperCase());
  if (!venueFee) return null;
  const special = venueFee.specialFees?.find((fee) => fee.symbol.toUpperCase() === market.symbol.toUpperCase());
  const parsed = Number(special?.takerFee ?? venueFee.futureTakerFee);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Rank executable long/short venue pairs. Funding APR is deliberately a scenario calculation:
 * it assumes the latest normalized 8h rate repeats unchanged and is never labelled expected PnL.
 */
export function buildArbitrageOpportunities(
  marketSnapshot: MarketSnapshot,
  fundingOverview: FundingOverviewResponse,
  fees: readonly VenueFeeRate[],
  options: ArbitrageOpportunityOptions = {},
): ArbitrageOpportunitiesResponse {
  const now = options.now ?? Date.now();
  const notionalPerLegUsd = options.notionalPerLegUsd ?? 1_000;
  const leverage = options.leverage ?? 3;
  const holdingHours = options.holdingHours ?? 24;
  const maxQuoteAgeMs = options.maxQuoteAgeMs ?? 15_000;
  const maxQuoteSkewMs = options.maxQuoteSkewMs ?? 5_000;
  const marketClass = options.marketClass ?? 'all';
  const fundingBySymbol = new Map(
    fundingOverview.assets.flatMap((asset) => asset.venues.map((venue) => [venue.symbol, venue] as const)),
  );
  const byAsset = new Map<string, LiveMarket[]>();
  for (const market of marketSnapshot.markets) {
    const rows = byAsset.get(market.asset) ?? [];
    rows.push(market);
    byAsset.set(market.asset, rows);
  }
  const opportunities: ArbitrageOpportunitiesResponse['opportunities'] = [];

  for (const [asset, markets] of byAsset) {
    if (!matchesMarketClass(asset, marketClass)) continue;
    for (const longMarket of markets) {
      for (const shortMarket of markets) {
        if (longMarket.venue === shortMarket.venue) continue;
        const longAsk = finitePositive(longMarket.askPrice);
        const longBid = finitePositive(longMarket.bidPrice);
        const shortBid = finitePositive(shortMarket.bidPrice);
        const shortAsk = finitePositive(shortMarket.askPrice);
        const invalidBook = longAsk === null || longBid === null || shortBid === null || shortAsk === null
          || longAsk < longBid || shortAsk < shortBid;
        const entrySpreadBps = invalidBook ? 0 : (shortBid! / longAsk! - 1) * 10_000;
        const exitSpreadBps = invalidBook ? 0 : (shortAsk! / longBid! - 1) * 10_000;
        const longFundingRaw = fundingBySymbol.get(longMarket.symbol)?.fundingRate8h;
        const shortFundingRaw = fundingBySymbol.get(shortMarket.symbol)?.fundingRate8h;
        const longFunding = Number(longFundingRaw);
        const shortFunding = Number(shortFundingRaw);
        const fundingKnown = longFundingRaw !== null && longFundingRaw !== undefined
          && shortFundingRaw !== null && shortFundingRaw !== undefined
          && Number.isFinite(longFunding) && Number.isFinite(shortFunding);
        const fundingSpread8hBps = fundingKnown ? (shortFunding - longFunding) * 10_000 : null;
        const scenarioFundingAprPct = fundingSpread8hBps === null ? null : fundingSpread8hBps * 3 * 365 / 100;
        const longFee = takerFee(fees, longMarket);
        const shortFee = takerFee(fees, shortMarket);
        const roundTripFeeBps = longFee === null || shortFee === null ? null : (longFee + shortFee) * 2 * 10_000;
        const netEdge24hBps = fundingSpread8hBps === null || roundTripFeeBps === null
          ? null
          : entrySpreadBps + fundingSpread8hBps * (holdingHours / 8) - roundTripFeeBps;
        const longUpdated = Date.parse(longMarket.updatedAt);
        const shortUpdated = Date.parse(shortMarket.updatedAt);
        const quoteSkewMs = Number.isFinite(longUpdated) && Number.isFinite(shortUpdated)
          ? Math.abs(longUpdated - shortUpdated) : Number.MAX_SAFE_INTEGER;
        const oldestQuoteAgeMs = Number.isFinite(longUpdated) && Number.isFinite(shortUpdated)
          ? Math.max(0, Math.round(now - Math.min(longUpdated, shortUpdated))) : Number.MAX_SAFE_INTEGER;
        const blockers: ArbitrageOpportunitiesResponse['opportunities'][number]['blockers'] = [];
        if (marketSnapshot.connectionState !== 'healthy') blockers.push('market_stream_unhealthy');
        if (longMarket.source !== 'gate_crossex_websocket' || shortMarket.source !== 'gate_crossex_websocket') blockers.push('demo_quote');
        if (oldestQuoteAgeMs > maxQuoteAgeMs) blockers.push('stale_quote');
        if (quoteSkewMs > maxQuoteSkewMs) blockers.push('quote_skew');
        if (invalidBook) blockers.push('invalid_book');
        if (!invalidBook && (shortBid! / longAsk! > 1.2 || shortBid! / longAsk! < 0.8)) blockers.push('cross_venue_price_dislocation');
        if (entrySpreadBps <= 0) blockers.push('entry_spread_nonpositive');
        if (!fundingKnown) blockers.push('funding_unavailable');
        if (roundTripFeeBps === null) blockers.push('fee_unavailable');
        if (netEdge24hBps !== null && netEdge24hBps <= 0) blockers.push('negative_24h_edge');
        opportunities.push({
          asset,
          marketClass: marketClassOf(asset),
          longVenue: longMarket.venue,
          shortVenue: shortMarket.venue,
          longSymbol: longMarket.symbol,
          shortSymbol: shortMarket.symbol,
          longAsk: longMarket.askPrice,
          shortBid: shortMarket.bidPrice,
          entrySpreadBps,
          exitSpreadBps,
          fundingSpread8hBps,
          scenarioFundingAprPct,
          roundTripFeeBps,
          netEdge24hBps,
          quoteSkewMs,
          oldestQuoteAgeMs,
          estimatedMarginUsd: notionalPerLegUsd * 2 / leverage * 1.1,
          executable: blockers.length === 0,
          blockers,
        });
      }
    }
  }

  opportunities.sort((left, right) => {
    if (left.executable !== right.executable) return left.executable ? -1 : 1;
    if (!left.executable && left.blockers.length !== right.blockers.length) return left.blockers.length - right.blockers.length;
    return (right.netEdge24hBps ?? Number.NEGATIVE_INFINITY) - (left.netEdge24hBps ?? Number.NEGATIVE_INFINITY);
  });
  return {
    opportunities: opportunities.slice(0, options.limit ?? 100),
    coverage: [],
    fetchedAt: new Date(now).toISOString(),
    assumptions: {
      notionalPerLegUsd,
      leverage,
      holdingHours,
      maxQuoteAgeMs,
      maxQuoteSkewMs,
      feeMode: 'taker_round_trip',
      annualization: 'current_8h_rate_unchanged_scenario',
      marketClass,
    },
  };
}
