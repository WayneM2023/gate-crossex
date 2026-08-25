import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api, type ArbitrageOpportunity, type ArbitrageOpportunitiesResponse } from './api.js';
import { useLanguage } from './i18n.js';
import type { PairedPositionPrefill } from './route-shared.js';
import type { ExchangeLogoId } from './exchange-logos.js';

interface ArbitrageViewProps {
  onConfigure: (prefill: PairedPositionPrefill) => void;
}

const bps = (value: number | null) => value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
const pct = (value: number | null) => value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const venueId = (venue: string) => venue.toLowerCase() as ExchangeLogoId;

const blockerLabels: Record<ArbitrageOpportunity['blockers'][number], string> = {
  market_stream_unhealthy: '行情连接异常', demo_quote: '非实盘行情', stale_quote: '行情过期', quote_skew: '两所不同步',
  invalid_book: '盘口无效', cross_venue_price_dislocation: '跨所价格异常', funding_unavailable: '费率缺失', fee_unavailable: '手续费缺失', negative_24h_edge: '24h费后边际≤0',
  entry_spread_nonpositive: '当前入场价差≤0',
};

export function ArbitrageView({ onConfigure }: ArbitrageViewProps) {
  const { t } = useLanguage();
  const [marketClass, setMarketClass] = useState<'all' | 'crypto' | 'hong_kong' | 'china_a'>('crypto');
  const [ranking, setRanking] = useState<'apr' | 'net' | 'executable'>('apr');
  const [notional, setNotional] = useState(1_000);
  const [leverage, setLeverage] = useState(3);
  const [holdingHours, setHoldingHours] = useState(24);
  const [data, setData] = useState<ArbitrageOpportunitiesResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const result = await api.arbitrageOpportunities({ notional, leverage, holdingHours, limit: 500, marketClass });
      setData(result);
      setError('');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('Backend unavailable'));
    } finally {
      setLoading(false);
    }
  }, [holdingHours, leverage, marketClass, notional, t]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  const allRows = useMemo(() => data?.opportunities ?? [], [data]);
  const executableCount = allRows.filter((row) => row.executable).length;
  const rows = useMemo(() => {
    const candidates = ranking === 'executable' ? allRows.filter((row) => row.executable) : [...allRows];
    candidates.sort((left, right) => ranking === 'net' || ranking === 'executable'
      ? (right.netEdge24hBps ?? Number.NEGATIVE_INFINITY) - (left.netEdge24hBps ?? Number.NEGATIVE_INFINITY)
      : (right.scenarioFundingAprPct ?? Number.NEGATIVE_INFINITY) - (left.scenarioFundingAprPct ?? Number.NEGATIVE_INFINITY));
    return candidates.slice(0, 100);
  }, [allRows, ranking]);

  return <main className="arbitrage-view alternate-view">
    <header className="view-heading arbitrage-heading">
      <div><p className="eyebrow">CROSSEX NATIVE ARBITRAGE</p><h1>跨所套利工作台</h1><p>统一行情、资金费率、账户手续费与双腿执行预检；Spread 项目保持独立。</p></div>
      <span className="arb-live-badge"><i />只读扫描 · 5 秒刷新</span>
    </header>
    <section className="arb-controls terminal-panel">
      <label><span>单腿名义价值</span><div><b>$</b><input type="number" min="1" step="100" value={notional} onChange={(event) => setNotional(Math.max(1, Number(event.target.value) || 1))} /></div></label>
      <label><span>预估杠杆</span><div><input type="number" min="1" max="100" step="1" value={leverage} onChange={(event) => setLeverage(Math.max(1, Number(event.target.value) || 1))} /><b>×</b></div></label>
      <label><span>持有情景</span><div><input type="number" min="1" max="720" step="1" value={holdingHours} onChange={(event) => setHoldingHours(Math.max(1, Number(event.target.value) || 1))} /><b>小时</b></div></label>
      <article><span>可执行组合</span><strong>{executableCount}</strong><small>共扫描 {allRows.length} 个方向</small></article>
      <article><span>双腿预估保证金</span><strong>{data ? money(data.assumptions.notionalPerLegUsd * 2 / data.assumptions.leverage * 1.1) : '—'}</strong><small>含 10% 预留；最终以风险限额为准</small></article>
      <button onClick={() => void refresh()} disabled={loading}>{loading ? '刷新中…' : '立即刷新'}</button>
    </section>
    <section className="arb-disclaimer"><strong>APR 不是预期收益。</strong>这里只把当前 8 小时标准化费率按全年不变做情景外推；实际下单排序使用所选持有期的费后净边际。</section>
    <section className="arb-market-tabs" aria-label="市场分类">
      {([['all', '全部'], ['crypto', '加密资产'], ['hong_kong', '港股 / 中概'], ['china_a', 'A股']] as const).map(([value, label]) => <button key={value} className={marketClass === value ? 'active' : ''} onClick={() => { setLoading(true); setMarketClass(value); }}>{label}</button>)}
    </section>
    {error && <p className="arb-error">机会接口异常：{error}</p>}
    {(marketClass === 'hong_kong' || marketClass === 'china_a') && data && <section className="arb-equity-coverage terminal-panel">
      <header><div><h2>{marketClass === 'hong_kong' ? '港股 / 中概永续覆盖' : 'A股永续覆盖'}</h2><p>至少两个 CrossEx 交易所有相同合约才可进入跨所套利。</p></div><strong>{data.coverage.filter((item) => item.arbitrageEligible).length} 可套利 / {data.coverage.length} 标的</strong></header>
      <div>{data.coverage.map((item) => <article key={item.asset} className={item.arbitrageEligible ? 'eligible' : ''}>
        <strong>{item.asset}</strong>
        <span>{item.quotes.map((quote) => `${quote.venue} ${quote.lastPrice ?? '订阅中'}`).join(' · ')}</span>
        <small>{item.quotes.filter((quote) => quote.live).map((quote) => `${quote.venue} ${quote.bidPrice} / ${quote.askPrice}`).join(' · ') || '等待实时 bid / ask'}</small>
        <em>{item.arbitrageEligible ? item.streamed ? '实时行情' : '订阅中' : '单所行情 · 仅观察'}</em>
      </article>)}</div>
    </section>}
    <section className="arb-table terminal-panel">
      <header><div><h2>机会排名</h2><p>同一标的的做多 / 做空方向分别计算，使用可成交 bid / ask。</p></div><div className="arb-ranking-switch" role="group" aria-label="机会排序"><button className={ranking === 'apr' ? 'active' : ''} onClick={() => setRanking('apr')}>最高情景 APR</button><button className={ranking === 'net' ? 'active' : ''} onClick={() => setRanking('net')}>{holdingHours}h 费后边际</button><button className={ranking === 'executable' ? 'active' : ''} onClick={() => setRanking('executable')}>仅看可执行</button></div><span>{data?.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString() : '—'}</span></header>
      <div className="table-wrap"><table><thead><tr><th>标的</th><th>方向</th><th>入场价差<br/>bps</th><th>资金差 / 8h<br/>bps</th><th>当前费率情景 APR</th><th>往返手续费<br/>bps</th><th>{holdingHours}h 费后边际<br/>bps</th><th>同步</th><th>状态</th><th /></tr></thead>
      <tbody>{rows.length ? rows.map((row) => <tr key={`${row.asset}-${row.longVenue}-${row.shortVenue}`} className={row.executable ? 'executable' : ''}>
        <td><strong>{row.asset}</strong></td><td><span className="arb-long">多 {row.longVenue}</span><span className="arb-short">空 {row.shortVenue}</span></td>
        <td className={row.entrySpreadBps >= 0 ? 'positive' : 'negative'}>{bps(row.entrySpreadBps)}</td>
        <td className={(row.fundingSpread8hBps ?? 0) >= 0 ? 'positive' : 'negative'}>{bps(row.fundingSpread8hBps)}</td>
        <td>{pct(row.scenarioFundingAprPct)}</td><td>{bps(row.roundTripFeeBps)}</td>
        <td className={(row.netEdge24hBps ?? 0) > 0 ? 'positive' : 'negative'}><strong>{bps(row.netEdge24hBps)}</strong></td>
        <td>{row.quoteSkewMs}ms<small>{row.oldestQuoteAgeMs}ms old</small></td>
        <td>{row.executable ? <em className="arb-ready">可预览</em> : <div className="arb-blockers">{row.blockers.map((blocker) => <em key={blocker}>{blockerLabels[blocker]}</em>)}</div>}</td>
        <td><button disabled={!row.executable} onClick={() => {
          const entry = Math.max(0.02, row.entrySpreadBps * 0.8);
          const takeProfit = Math.max(0.01, Math.min(entry * 0.5, Math.max(0.01, row.exitSpreadBps * 0.25)));
          onConfigure({ asset: row.asset, longVenue: venueId(row.longVenue), shortVenue: venueId(row.shortVenue), entryBps: entry.toFixed(2), takeProfitBps: takeProfit.toFixed(2), emergencyStopBps: Math.max(entry + 10, entry * 2).toFixed(2) });
        }}>配置策略</button></td>
      </tr>) : <tr><td colSpan={10} className="arb-empty">{loading ? '正在同步行情、费率与手续费…' : '当前没有可比较的跨所组合'}</td></tr>}</tbody></table></div>
    </section>
  </main>;
}
