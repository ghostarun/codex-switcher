import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
    AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import './Stats.css';

interface TokenHistoryEntry {
    timestamp: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cost: number;
}

interface SwitchEvent {
    timestamp: string;
    from_account: string | null;
    to_account: string;
    reason: string;
    from_quota_5h: number | null;
    to_quota_5h: number | null;
}

interface SwitchStats {
    today_count: number;
    week_count: number;
    total_count: number;
    by_reason: Record<string, number>;
    by_account: Record<string, number>;
}

interface TokenStats {
    total_input_tokens: number;
    total_output_tokens: number;
    total_tokens: number;
    total_cost_usd: number;
    total_requests: number;
}

interface PlanCapacityEstimate {
    plan_type: string;
    window_type: '5h' | 'week';
    sample_count: number;
    avg_capacity: number;
    median_capacity: number;
    min_capacity: number;
    max_capacity: number;
}

interface SessionInCycle {
    session_key: string;
    total_tokens: number;
    turn_count: number;
    first_seen_at: number;
    last_seen_at: number;
}

interface CycleDetail {
    window_start: number;
    window_end: number;
    is_current: boolean;
    total_tokens: number;
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
    turn_count: number;
    sessions: SessionInCycle[];
    estimated_capacity: number | null;
    estimate_used_pct: number | null;
    hit_limit: boolean;
    last_switch_reason: string | null;
}

interface AccountTokenHistory {
    account_id: string;
    email: string;
    plan_type: string;
    is_current: boolean;
    is_banned: boolean;
    is_token_invalid: boolean;
    current_5h: CycleDetail | null;
    last_5h: CycleDetail | null;
    current_week: CycleDetail | null;
    last_week: CycleDetail | null;
    cycles_5h: CycleDetail[];
    cycles_week: CycleDetail[];
}

const COLORS = ['#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#14b8a6', '#f97316'];

function formatTokens(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toString();
}

function formatTime(ts: string): string {
    const d = new Date(ts);
    return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDuration(from: string, to: string): string {
    const diff = new Date(to).getTime() - new Date(from).getTime();
    if (diff < 0) return '-';
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    if (hours > 0) return `${hours}h ${mins % 60}m`;
    return `${mins}m`;
}

type TimeRange = 'day' | 'week' | 'month';

export function Stats() {
    const [range, setRange] = useState<TimeRange>('week');
    const [tokenHistory, setTokenHistory] = useState<TokenHistoryEntry[]>([]);
    const [switchHistory, setSwitchHistory] = useState<SwitchEvent[]>([]);
    const [switchStats, setSwitchStats] = useState<SwitchStats | null>(null);
    const [tokenStats, setTokenStats] = useState<TokenStats | null>(null);
    const [planCaps, setPlanCaps] = useState<PlanCapacityEstimate[]>([]);
    const [accountHistory, setAccountHistory] = useState<AccountTokenHistory[]>([]);
    const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
    const [expandedCycle, setExpandedCycle] = useState<string | null>(null);

    const days = range === 'day' ? 1 : range === 'week' ? 7 : 30;

    const fetchData = async () => {
        try {
            const [th, sh, ss, ts, pc, ah] = await Promise.all([
                invoke<TokenHistoryEntry[]>('get_token_history', { days }),
                invoke<SwitchEvent[]>('get_switch_history', { days }),
                invoke<SwitchStats>('get_switch_stats'),
                invoke<TokenStats>('get_token_stats'),
                invoke<PlanCapacityEstimate[]>('get_plan_capacity_estimates'),
                invoke<AccountTokenHistory[]>('get_account_token_history'),
            ]);
            setTokenHistory(th);
            setSwitchHistory(sh.reverse());
            setSwitchStats(ss);
            setTokenStats(ts);
            setPlanCaps(pc);
            setAccountHistory(ah);
        } catch (e) {
            console.error('Failed to load stats:', e);
        }
    };

    useEffect(() => { fetchData(); }, [range]);

    // Aggregate token trend (by hour/day)
    const trendData = (() => {
        const buckets: Record<string, { label: string; input: number; output: number; cost: number }> = {};
        for (const entry of tokenHistory) {
            const d = new Date(entry.timestamp);
            const key = range === 'day'
                ? d.toLocaleTimeString('zh-CN', { hour: '2-digit' })
                : d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
            if (!buckets[key]) buckets[key] = { label: key, input: 0, output: 0, cost: 0 };
            buckets[key].input += entry.input_tokens;
            buckets[key].output += entry.output_tokens;
            buckets[key].cost += entry.cost;
        }
        return Object.values(buckets);
    })();

    // Model distribution (pie)
    const modelData = (() => {
        const map: Record<string, number> = {};
        for (const entry of tokenHistory) {
            map[entry.model] = (map[entry.model] || 0) + entry.input_tokens + entry.output_tokens;
        }
        return Object.entries(map).map(([name, value]) => ({ name, value }));
    })();

    // Switch reason distribution
    const reasonData = switchStats
        ? Object.entries(switchStats.by_reason).map(([name, value]) => ({ name, value }))
        : [];

    const accountCount = switchStats ? Object.keys(switchStats.by_account).length : 0;

    // Separate user switches from system tasks
    const actualSwitches = switchHistory.filter(e => e.reason !== 'Auto refresh' && e.reason !== 'Background keepalive');
    const systemLogs = switchHistory.filter(e => e.reason === 'Auto refresh' || e.reason === 'Background keepalive');

    return (
        <div className="stats-page">
            <div className="stats-header">
                <h2>Statistics</h2>
                <div className="time-range-btns">
                    {(['day', 'week', 'month'] as TimeRange[]).map(r => (
                        <button
                            key={r}
                            className={`range-btn ${range === r ? 'active' : ''}`}
                            onClick={() => setRange(r)}
                        >
                            {r === 'day' ? 'D' : r === 'week' ? 'W' : 'M'}
                        </button>
                    ))}
                </div>
            </div>

            {/* Summary cards */}
            <div className="stats-cards">
                <div className="stat-card purple">
                    <div className="stat-card-value">{formatTokens(tokenStats?.total_tokens ?? 0)}</div>
                    <div className="stat-card-label">Total tokens</div>
                </div>
                <div className="stat-card yellow">
                    <div className="stat-card-value">${(tokenStats?.total_cost_usd ?? 0).toFixed(2)}</div>
                    <div className="stat-card-label">Total cost</div>
                </div>
                <div className="stat-card green">
                    <div className="stat-card-value">{switchStats?.total_count ?? 0}</div>
                    <div className="stat-card-label">Switch count</div>
                </div>
                <div className="stat-card blue">
                    <div className="stat-card-value">{accountCount}</div>
                    <div className="stat-card-label">Accounts used</div>
                </div>
            </div>

            {/* Plan quota ceiling estimate (quota snapshot Δpct) */}
            {planCaps.length > 0 && (() => {
                const allPlans = Array.from(new Set(planCaps.map(p => p.plan_type))).sort();
                return (
                    <div className="stats-section">
                        <h3>Plan quota ceiling (Δpct inverse; no need to max account)</h3>
                        <div className="cycle-summary">
                            <div className="cycle-summary-row cycle-summary-header capacity-header">
                                <span>Plan</span>
                                <span className="num">5h samples</span>
                                <span className="num">5h median</span>
                                <span className="num">5h mean</span>
                                <span className="num">5h min–max</span>
                                <span className="num">Weekly samples</span>
                                <span className="num">Weekly median</span>
                                <span className="num">Weekly mean</span>
                                <span className="num">Weekly min–max</span>
                            </div>
                            {allPlans.map(plan => {
                                const f = planCaps.find(p => p.plan_type === plan && p.window_type === '5h');
                                const w = planCaps.find(p => p.plan_type === plan && p.window_type === 'week');
                                return (
                                    <div key={plan} className="cycle-summary-row capacity-row">
                                        <span>
                                            <span className={`quota-plan plan-${plan.toLowerCase()}`}>{plan || '—'}</span>
                                        </span>
                                        <span className="num">{f?.sample_count ?? '—'}</span>
                                        <span className="num total">{f ? formatTokens(f.median_capacity) : '—'}</span>
                                        <span className="num">{f ? formatTokens(f.avg_capacity) : '—'}</span>
                                        <span className="num observed">
                                            {f ? `${formatTokens(f.min_capacity)}–${formatTokens(f.max_capacity)}` : '—'}
                                        </span>
                                        <span className="num">{w?.sample_count ?? '—'}</span>
                                        <span className="num total">{w ? formatTokens(w.median_capacity) : '—'}</span>
                                        <span className="num">{w ? formatTokens(w.avg_capacity) : '—'}</span>
                                        <span className="num observed">
                                            {w ? `${formatTokens(w.min_capacity)}–${formatTokens(w.max_capacity)}` : '—'}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="cycle-hint">
                            <b>How it works</b>: On each switch we capture quota into `~/.codex-switcher/quota-snapshots.jsonl`. Δused_pct between two snapshots in the same window plus proxy tokens in between → Plan capacity (capacity = Δtokens / Δpct × 100).<br/>
                            <b>Median</b> is the robust estimate after dropping outliers. Samples with Δpct&lt;3% are dropped (used_pct is integer; quantization error).<br/>
                            Samples accumulate on each switch; below ~5 samples the estimate is noisy — use for a few hours.
                        </div>
                    </div>
                );
            })()}

            {/* Per-account token history (account → cycle → session) */}
            {accountHistory.length > 0 && (
                <div className="stats-section">
                    <h3>Per-account token history (exact sum + estimate)</h3>
                    <div className="acct-hist-table">
                        <div className="acct-hist-row acct-hist-header">
                            <span></span>
                            <span>Email / Plan</span>
                            <span className="num">Current 5h</span>
                            <span className="num">Previous 5h</span>
                            <span className="num">Current week</span>
                            <span className="num">Previous week</span>
                        </div>
                        {accountHistory.map(acc => {
                            const expanded = expandedAccount === acc.account_id;
                            return (
                                <div key={acc.account_id}>
                                    <div
                                        className={`acct-hist-row clickable ${acc.is_current ? 'current' : ''}`}
                                        onClick={() => {
                                            setExpandedAccount(expanded ? null : acc.account_id);
                                            setExpandedCycle(null);
                                        }}
                                    >
                                        <span className="acct-toggle">{expanded ? '▼' : '▶'}</span>
                                        <span className="acct-email" title={acc.email}>
                                            {acc.is_current && <span className="quota-badge current">Current</span>}
                                            {acc.is_banned && <span className="quota-badge banned">Banned</span>}
                                            {acc.is_token_invalid && <span className="quota-badge invalid">Invalid</span>}
                                            <span className={`quota-plan plan-${(acc.plan_type || 'unknown').toLowerCase()}`}>{acc.plan_type || '—'}</span>
                                            <span className="acct-email-text">{acc.email}</span>
                                        </span>
                                        <CellPair cycle={acc.current_5h} />
                                        <CellPair cycle={acc.last_5h} />
                                        <CellPair cycle={acc.current_week} />
                                        <CellPair cycle={acc.last_week} />
                                    </div>
                                    {expanded && (
                                        <div className="acct-hist-expand">
                                            <div className="acct-cycle-header">5h cycles ({acc.cycles_5h.length})</div>
                                            <CycleHistoryTable
                                                cycles={acc.cycles_5h}
                                                accountId={acc.account_id}
                                                windowLabel="5h"
                                                expandedCycle={expandedCycle}
                                                setExpandedCycle={setExpandedCycle}
                                            />
                                            <div className="acct-cycle-header">Weekly cycles ({acc.cycles_week.length})</div>
                                            <CycleHistoryTable
                                                cycles={acc.cycles_week}
                                                accountId={acc.account_id}
                                                windowLabel="week"
                                                expandedCycle={expandedCycle}
                                                setExpandedCycle={setExpandedCycle}
                                            />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <div className="cycle-hint">
                        Each cell shows <b>Exact sum / Estimated cap</b>.<br/>
                        <b>Exact sum</b> = exact sum from token-history.jsonl in that window (no averaging, regardless of switches).<br/>
                        <b>Estimated cap</b> = `Exact sum ÷ snapshot used_pct × 100` using max used_pct in snapshots (least quantization error). `?%` means used_pct was low — estimate is rough.<br/>
                        🔴 = quota switch triggered in window — Exact sum ≈ actual Plan window quota.<br/>
                        Expand account for cycles; expand cycle for session detail.
                    </div>
                </div>
            )}

            {/* Token trend chart */}
            {trendData.length > 0 && (
                <div className="stats-section">
                    <h3>Token trend</h3>
                    <ResponsiveContainer width="100%" height={250}>
                        <AreaChart data={trendData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                            <XAxis dataKey="label" stroke="rgba(255,255,255,0.3)" fontSize={11} />
                            <YAxis stroke="rgba(255,255,255,0.3)" fontSize={11} tickFormatter={formatTokens} />
                            <Tooltip
                                contentStyle={{ background: '#1e1245', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
                                labelStyle={{ color: '#fff' }}
                            />
                            <Area type="monotone" dataKey="input" stackId="1" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.4} name="Input" />
                            <Area type="monotone" dataKey="output" stackId="1" stroke="#10b981" fill="#10b981" fillOpacity={0.4} name="Output" />
                            <Legend />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* Bottom: cost + model mix */}
            <div className="stats-grid">
                {trendData.length > 0 && (
                    <div className="stats-section">
                        <h3>Cost trend</h3>
                        <ResponsiveContainer width="100%" height={200}>
                            <BarChart data={trendData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                                <XAxis dataKey="label" stroke="rgba(255,255,255,0.3)" fontSize={11} />
                                <YAxis stroke="rgba(255,255,255,0.3)" fontSize={11} tickFormatter={v => `$${v}`} />
                                <Tooltip
                                    contentStyle={{ background: '#1e1245', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
                                    formatter={(v) => [`$${Number(v).toFixed(4)}`, 'Cost']}
                                />
                                <Bar dataKey="cost" fill="#fbbf24" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}

                {(modelData.length > 0 || reasonData.length > 0) && (
                    <div className="stats-section">
                        <h3>{modelData.length > 0 ? 'Model mix' : 'Switch reasons'}</h3>
                        <ResponsiveContainer width="100%" height={200}>
                            <PieChart>
                                <Pie
                                    data={modelData.length > 0 ? modelData : reasonData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={50}
                                    outerRadius={80}
                                    paddingAngle={3}
                                    dataKey="value"
                                >
                                    {(modelData.length > 0 ? modelData : reasonData).map((_, i) => (
                                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{ background: '#1e1245', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
                                />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>

            {/* Switch log */}
            <div className="stats-section">
                <h3>Switch log ({actualSwitches.length})</h3>
                <div className="switch-log-table">
                    <div className="log-header">
                        <span>Time</span>
                        <span>Path</span>
                        <span>Reason</span>
                        <span>Duration</span>
                    </div>
                    {actualSwitches.length === 0 ? (
                        <div className="log-empty">No switch records yet</div>
                    ) : (
                        actualSwitches.map((e, i) => (
                            <div key={i} className="log-row">
                                <span className="log-time">{formatTime(e.timestamp)}</span>
                                <span className="log-path">
                                    {e.from_account ? (
                                        <>{shortName(e.from_account)} → {shortName(e.to_account)}</>
                                    ) : (
                                        <>→ {shortName(e.to_account)}</>
                                    )}
                                </span>
                                <span className={`log-reason ${reasonClass(e.reason)}`}>{e.reason}</span>
                                <span className="log-duration">
                                    {i < actualSwitches.length - 1
                                        ? formatDuration(actualSwitches[i + 1].timestamp, e.timestamp)
                                        : '-'}
                                </span>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Background task log */}
            {systemLogs.length > 0 && (
                <div className="stats-section">
                    <h3>Background log ({actualSwitches.length})</h3>
                    <div className="switch-log-table">
                        <div className="log-header">
                            <span>Time</span>
                            <span>Target account</span>
                            <span>Task type</span>
                            <span>Quota after refresh</span>
                        </div>
                        {systemLogs.map((e, i) => (
                            <div key={`sys-${i}`} className="log-row">
                                <span className="log-time">{formatTime(e.timestamp)}</span>
                                <span className="log-path">
                                    {shortName(e.to_account)}
                                </span>
                                <span className={`log-reason ${reasonClass(e.reason)}`}>{e.reason}</span>
                                <span className="log-duration" style={{ color: 'var(--success-color, #10b981)' }}>
                                    {e.to_quota_5h !== null ? `${e.to_quota_5h}%` : 'OK'}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function shortName(name: string): string {
    if (name.length > 18) return name.slice(0, 15) + '...';
    return name;
}

function formatWindow(startSec: number, endSec: number): string {
    const s = new Date(startSec * 1000);
    const e = new Date(endSec * 1000);
    const fmtDate = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
    const fmtTime = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (fmtDate(s) === fmtDate(e)) {
        return `${fmtDate(s)} ${fmtTime(s)}-${fmtTime(e)}`;
    }
    return `${fmtDate(s)} ${fmtTime(s)} → ${fmtDate(e)} ${fmtTime(e)}`;
}

/// Top cell: Exact sum / Estimated cap
/// null uses same two-row cell-pair for alignment
function CellPair({ cycle }: { cycle: CycleDetail | null }) {
    if (!cycle) {
        return (
            <span className="num cell-pair cell-empty">
                <span className="cell-actual">—</span>
                <span className="cell-est">&nbsp;</span>
            </span>
        );
    }
    const cap = cycle.estimated_capacity;
    const pct = cycle.estimate_used_pct;
    const lowConfidence = pct != null && pct < 10;
    const isFallback = !cycle.is_current;
    return (
        <span className={`num cell-pair ${isFallback ? 'cell-fallback' : ''}`}>
            <span className="cell-actual">
                {cycle.hit_limit && <span className="cell-fire">🔴</span>}
                {formatTokens(cycle.total_tokens)}
            </span>
            <span className="cell-est" title={pct != null ? `quota snapshot used_pct=${pct}% · window ${formatWindow(cycle.window_start, cycle.window_end)}` : `window ${formatWindow(cycle.window_start, cycle.window_end)}`}>
                {isFallback && <span className="cell-fallback-tag">Latest</span>}
                {cap != null
                    ? `~${formatTokens(cap)}${lowConfidence ? '?' : ''}`
                    : (isFallback ? <>&nbsp;</> : ' ')}
            </span>
        </span>
    );
}

/// Cycle list (5h or week). Expand row for sessions.
function CycleHistoryTable({
    cycles,
    accountId,
    windowLabel,
    expandedCycle,
    setExpandedCycle,
}: {
    cycles: CycleDetail[];
    accountId: string;
    windowLabel: '5h' | 'week';
    expandedCycle: string | null;
    setExpandedCycle: (k: string | null) => void;
}) {
    if (cycles.length === 0) {
        return <div className="acct-empty">No data</div>;
    }
    return (
        <div className="hist-cycle-table">
            <div className="hist-cycle-row hist-cycle-header">
                <span></span>
                <span>Window</span>
                <span className="num">Exact sum</span>
                <span className="num">Estimated cap</span>
                <span className="num">used_pct</span>
                <span className="num">Rounds</span>
                <span className="num">Sessions</span>
                <span>Status</span>
            </div>
            {cycles.map(c => {
                const key = `${accountId}-${windowLabel}-${c.window_end}`;
                const expanded = expandedCycle === key;
                const rowCls = c.is_current
                    ? 'current'
                    : c.hit_limit
                        ? 'limit-hit'
                        : '';
                const statusLabel = c.is_current
                    ? 'In progress'
                    : c.hit_limit
                        ? `🔴 ${c.last_switch_reason ?? 'Quota'}`
                        : 'OK';
                return (
                    <div key={key}>
                        <div
                            className={`hist-cycle-row clickable ${rowCls}`}
                            onClick={() => setExpandedCycle(expanded ? null : key)}
                        >
                            <span className="acct-toggle">{expanded ? '▼' : '▶'}</span>
                            <span className="cycle-window">{formatWindow(c.window_start, c.window_end)}</span>
                            <span className="num total">{c.total_tokens.toLocaleString()}</span>
                            <span className="num">
                                {c.estimated_capacity != null ? `~${formatTokens(c.estimated_capacity)}` : '—'}
                            </span>
                            <span className="num">
                                {c.estimate_used_pct != null ? `${c.estimate_used_pct}%` : '—'}
                            </span>
                            <span className="num">{c.turn_count}</span>
                            <span className="num">{c.sessions.length}</span>
                            <span className={c.is_current ? 'cycle-status current' : c.hit_limit ? 'cycle-status limit' : 'cycle-status done'}>
                                {statusLabel}
                            </span>
                        </div>
                        {expanded && (
                            <div className="hist-session-table">
                                <div className="hist-session-row hist-session-header">
                                    <span>Session</span>
                                    <span className="num">Rounds</span>
                                    <span className="num">Token</span>
                                    <span>First → last</span>
                                </div>
                                {c.sessions.map((s, idx) => (
                                    <div key={idx} className="hist-session-row">
                                        <span className="cycle-window" title={s.session_key}>{s.session_key.length > 40 ? s.session_key.slice(0, 40) + '…' : s.session_key}</span>
                                        <span className="num">{s.turn_count}</span>
                                        <span className="num total">{s.total_tokens.toLocaleString()}</span>
                                        <span className="cycle-window">
                                            {formatWindow(s.first_seen_at, s.last_seen_at)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function reasonClass(reason: string): string {
    if (reason.includes('Manual')) return 'manual';
    if (reason.includes('429') || reason.includes('Quota')) return 'ratelimit';
    if (reason.includes('Banned')) return 'banned';
    if (reason.includes('Keepalive')) return 'keepalive';
    if (reason.includes('Refresh')) return 'refresh';
    return 'auto';
}
