import { useCallback, useEffect, useState } from 'react';

type Row = Record<string, unknown>;
interface SpreadOverview {
  generatedAt: string;
  sourceUpdatedAt: string | null;
  sourceAgeSeconds: number | null;
  healthy: boolean;
  marketData: { crossExEnabled: boolean; lighterRoute: string; fallback: string };
  crossExAccount?: {
    available: boolean; reason: string | null; accountMode?: string; sharedMargin?: boolean;
    availableMargin?: number | null; marginBalance?: number | null; initialMargin?: number | null;
    maintenanceMargin?: number | null; maintenanceCoveragePct?: number | null; verifiedAt?: string | null;
  };
  summary: { realizedPnlUsd: number; totalFeesUsd: number; positions: number; openPositions: number; wins: number; losses: number };
  openPositions: Row[];
  recentClosed: Row[];
  topCandidates: Row[];
  rejected: Row[];
}

const money = (value: unknown) => `${Number(value) >= 0 ? '+' : '-'}$${Math.abs(Number(value) || 0).toFixed(2)}`;
const number = (value: unknown, digits = 2) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—';

export function SpreadView() {
  const [data, setData] = useState<SpreadOverview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/spread/overview', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setData(await response.json() as SpreadOverview);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Spread monitor unavailable');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (loading && !data) return <main className="spread-view"><p>Loading Spread monitor…</p></main>;
  if (!data) return <main className="spread-view"><p className="spread-error">Spread monitor unavailable · {error}</p></main>;
  const winRate = data.summary.wins + data.summary.losses
    ? data.summary.wins / (data.summary.wins + data.summary.losses) * 100 : 0;
  const account = data.crossExAccount;
  return <main className="spread-view">
    <header className="spread-header">
      <div><p className="eyebrow">CROSS-VENUE ARBITRAGE</p><h1>Spread Monitor</h1><p>策略运行在服务器；关闭此页面不会停止策略。</p></div>
      <div className="spread-health"><i className={data.healthy ? 'healthy' : 'stale'} />{data.healthy ? '数据正常' : '数据过期'}<button onClick={() => void refresh()}>刷新</button></div>
    </header>
    <section className="spread-cards">
      <article><span>累计已实现 PNL</span><strong className={data.summary.realizedPnlUsd >= 0 ? 'positive' : 'negative'}>{money(data.summary.realizedPnlUsd)}</strong></article>
      <article><span>累计费用</span><strong>${data.summary.totalFeesUsd.toFixed(2)}</strong></article>
      <article><span>胜率</span><strong>{winRate.toFixed(1)}%</strong><small>{data.summary.wins} 胜 / {data.summary.losses} 负</small></article>
      <article><span>当前仓位</span><strong>{data.summary.openPositions}</strong><small>历史 {data.summary.positions} 笔</small></article>
      <article><span>行情路由</span><strong>{data.marketData.crossExEnabled ? 'CrossEx 优先' : '交易所直连'}</strong><small>Lighter {data.marketData.lighterRoute}</small></article>
      <article><span>快照延迟</span><strong>{number(data.sourceAgeSeconds, 0)}s</strong><small>{data.sourceUpdatedAt ?? '—'}</small></article>
    </section>
    <section className="spread-cards spread-risk-cards">
      <article><span>CrossEx 账户模式</span><strong>{account?.available ? account.sharedMargin ? '共享保证金' : '交易所隔离' : '未连接'}</strong><small>{account?.accountMode ?? account?.reason ?? '—'}</small></article>
      <article><span>可用保证金</span><strong>{account?.availableMargin == null ? '—' : `$${number(account.availableMargin)}`}</strong><small>Gate account-level</small></article>
      <article><span>保证金余额</span><strong>{account?.marginBalance == null ? '—' : `$${number(account.marginBalance)}`}</strong><small>包含跨所未实现 PNL</small></article>
      <article><span>起始保证金</span><strong>{account?.initialMargin == null ? '—' : `$${number(account.initialMargin)}`}</strong><small>当前仓位与挂单占用</small></article>
      <article><span>维持保证金</span><strong>{account?.maintenanceMargin == null ? '—' : `$${number(account.maintenanceMargin)}`}</strong><small>账户强平基准</small></article>
      <article><span>维持保证金覆盖率</span><strong>{account?.maintenanceCoveragePct == null ? '—' : `${number(account.maintenanceCoveragePct, 0)}%`}</strong><small>≤100% 触发强平流程</small></article>
    </section>
    <SpreadTable title="当前仓位" rows={data.openPositions} columns={[
      ['symbol','标的'], ['long_venue','做多'], ['short_venue','做空'], ['entry_net_edge_bps','入场净边际 bps'], ['peak_net_pnl_usd','最高浮盈'], ['trailing_stop_usd','追踪线'], ['opened_at','开仓时间'],
    ]} />
    <SpreadTable title="Top 候选机会" rows={data.topCandidates} columns={[
      ['symbol','标的'], ['long_venue','做多'], ['short_venue','做空'], ['executable_spread_bps','可执行价差 bps'], ['net_edge_bps','净边际 bps'], ['spread_zscore','Z-score'], ['estimated_net_usd','预计净收益'],
    ]} />
    <SpreadTable title="最近平仓" rows={data.recentClosed} columns={[
      ['symbol','标的'], ['long_venue','做多'], ['short_venue','做空'], ['realized_pnl_usd','PNL'], ['close_reason','退出原因'], ['closed_at','平仓时间'],
    ]} />
    <SpreadTable title="近期拒绝" rows={data.rejected} columns={[
      ['symbol','标的'], ['long_venue','做多'], ['short_venue','做空'], ['net_edge_bps','净边际 bps'], ['reason','拒绝原因'],
    ]} />
  </main>;
}

function SpreadTable({ title, rows, columns }: { title: string; rows: Row[]; columns: [string,string][] }) {
  return <section className="spread-table terminal-panel"><header><h2>{title}</h2><span>{rows.length} 条</span></header><div className="table-wrap"><table><thead><tr>{columns.map(([,label]) => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row,index) => <tr key={`${String(row.position_id ?? row.symbol ?? index)}-${index}`}>{columns.map(([key]) => {
    const value = row[key];
    const pnl = key.includes('pnl') || key === 'estimated_net_usd';
    return <td key={key} className={pnl ? Number(value) >= 0 ? 'positive' : 'negative' : ''}>{pnl ? money(value) : typeof value === 'number' ? number(value) : String(value ?? '—')}</td>;
  })}</tr>) : <tr><td colSpan={columns.length} className="spread-empty">暂无数据</td></tr>}</tbody></table></div></section>;
}
