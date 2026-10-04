import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Account, effectiveKind } from '../hooks/useAccounts';
import {
    CodexSession,
    SessionRoute,
    isLikelyUuid,
    shortSessionId,
    formatRelativeTime,
    basename,
    truncate,
} from '../data/session_routes';
import './AddRelayModal.css';
import './AddRouteModal.css';

interface AddRouteModalProps {
    isOpen: boolean;
    accounts: Account[];
    onClose: () => void;
    onSuccess?: (route: SessionRoute) => void;
}

type SourceMode = 'recent' | 'manual';

function categoryBadge(account: Account): { label: string; className: string } {
    const kind = effectiveKind(account);
    if (kind === 'chatgpt_oauth') return { label: 'Subscription', className: 'cs-rbadge cs-rbadge--sub' };
    if (kind === 'openai_key') return { label: 'API', className: 'cs-rbadge cs-rbadge--mono' };
    // relay → use relay_category
    switch (account.relay_category) {
        case 'coding_plan':
            return { label: 'Plan', className: 'cs-rbadge cs-rbadge--sub' };
        case 'third_party':
            return { label: 'Third-party', className: 'cs-rbadge cs-rbadge--mono' };
        case 'aggregator':
        default:
            return { label: 'Relay', className: 'cs-rbadge cs-rbadge--mono' };
    }
}

function accountHealth(account: Account): 'ok' | 'bad' {
    if (account.is_banned || account.is_token_invalid || account.is_logged_out) return 'bad';
    if (account.cached_quota?.is_valid_for_cli === false) return 'bad';
    return 'ok';
}

function accountQuotaSummary(account: Account): string {
    const kind = effectiveKind(account);
    if (kind === 'relay') {
        const c = account.relay_usage_cache;
        if (c && c.is_active) {
            // Show unit as-is; backend uses "USD" / "tokens" / etc.
            return `Balance ${c.remaining.toFixed(2)} ${c.unit}`;
        }
        return '';
    }
    const q = account.cached_quota;
    if (!q) return '';
    // five_hour_left / weekly_left are integer percentages 0..100 in the cached
    // shape we get from useAccounts (legacy behavior — same as Dashboard).
    const fh = Number.isFinite(q.five_hour_left) ? `5h ${q.five_hour_left}%` : '';
    const wk = Number.isFinite(q.weekly_left) ? `Week ${q.weekly_left}%` : '';
    return [fh, wk].filter(Boolean).join(' · ');
}

export function AddRouteModal({ isOpen, accounts, onClose, onSuccess }: AddRouteModalProps) {
    const [sourceMode, setSourceMode] = useState<SourceMode>('recent');

    // Recent sessions
    const [sessions, setSessions] = useState<CodexSession[]>([]);
    const [sessionsLoading, setSessionsLoading] = useState(false);
    const [sessionsError, setSessionsError] = useState<string | null>(null);
    const [sessionSearch, setSessionSearch] = useState('');
    const [cwdFilter, setCwdFilter] = useState<string>('');

    // Selected session — either from list or pasted
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    const [manualSessionId, setManualSessionId] = useState('');

    // Latest rollout written in last 5 min = active codex session
    const [activeSession, setActiveSession] = useState<CodexSession | null>(null);

    // Account picker
    const [accountSearch, setAccountSearch] = useState('');
    const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

    // Label
    const [label, setLabel] = useState('');

    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reset everything when the modal closes.
    useEffect(() => {
        if (!isOpen) {
            setSourceMode('recent');
            setSessions([]);
            setSessionsError(null);
            setSessionSearch('');
            setCwdFilter('');
            setSelectedSessionId(null);
            setManualSessionId('');
            setActiveSession(null);
            setAccountSearch('');
            setSelectedAccountId(null);
            setLabel('');
            setSubmitting(false);
            setError(null);
        }
    }, [isOpen]);

    // On open, detect active codex session (rollout in last 5 min)
    // Use current session fills session_id without manual copy.
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        invoke<CodexSession | null>('detect_active_codex_session', { windowSecs: 300 })
            .then((s) => {
                if (!cancelled) setActiveSession(s);
            })
            .catch(() => {
                /* No active session is OK — ignore */
            });
        return () => {
            cancelled = true;
        };
    }, [isOpen]);

    // Load recent sessions when modal opens / mode switches to recent.
    useEffect(() => {
        if (!isOpen || sourceMode !== 'recent') return;
        let cancelled = false;
        setSessionsLoading(true);
        setSessionsError(null);
        invoke<CodexSession[]>('list_codex_sessions', { limit: 50, daysBack: 14 })
            .then((rows) => {
                if (cancelled) return;
                setSessions(rows);
            })
            .catch((e) => {
                if (cancelled) return;
                setSessionsError(typeof e === 'string' ? e : String(e));
            })
            .finally(() => {
                if (!cancelled) setSessionsLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [isOpen, sourceMode]);

    // Distinct cwds for the filter dropdown.
    const cwdOptions = useMemo(() => {
        const set = new Set<string>();
        for (const s of sessions) {
            if (s.cwd) set.add(s.cwd);
        }
        return Array.from(set).sort();
    }, [sessions]);

    // Filter visible sessions by search + cwd.
    const filteredSessions = useMemo(() => {
        const q = sessionSearch.trim().toLowerCase();
        return sessions.filter((s) => {
            if (cwdFilter && s.cwd !== cwdFilter) return false;
            if (!q) return true;
            const hay = `${s.cwd ?? ''} ${s.first_user_text ?? ''} ${s.session_id}`.toLowerCase();
            return hay.includes(q);
        });
    }, [sessions, sessionSearch, cwdFilter]);

    // Filter accounts.
    const filteredAccounts = useMemo(() => {
        const q = accountSearch.trim().toLowerCase();
        if (!q) return accounts;
        return accounts.filter((a) =>
            a.name.toLowerCase().includes(q) ||
            (a.notes ?? '').toLowerCase().includes(q) ||
            (a.relay_base_url ?? '').toLowerCase().includes(q),
        );
    }, [accounts, accountSearch]);

    const effectiveSessionId = sourceMode === 'recent' ? selectedSessionId : manualSessionId.trim();
    const sessionValid = sourceMode === 'recent'
        ? !!selectedSessionId
        : isLikelyUuid(manualSessionId);
    const canSubmit = sessionValid && !!selectedAccountId && !submitting;

    const handleSubmit = async () => {
        if (!effectiveSessionId || !selectedAccountId) return;
        setError(null);
        setSubmitting(true);
        try {
            const route = await invoke<SessionRoute>('add_session_route', {
                sessionId: effectiveSessionId,
                accountId: selectedAccountId,
                label: label.trim() || null,
            });
            onSuccess?.(route);
            onClose();
        } catch (e) {
            setError(typeof e === 'string' ? e : String(e));
        } finally {
            setSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="cs-relay-modal cs-relay-modal__overlay" onClick={onClose}>
            <div className="cs-relay-modal__panel" onClick={(e) => e.stopPropagation()}>
                <div className="cs-relay-modal__header">
                    <div className="cs-relay-modal__title">
                        <div className="cs-relay-modal__icon">↦</div>
                        <h2>AddRoutes</h2>
                        <span className="cs-relay-modal__sub">Pin session to account</span>
                    </div>
                    <button className="cs-relay-modal__close" onClick={onClose}>×</button>
                </div>

                <div className="cs-relay-modal__body">
                    <div className="cs-route-modal__body-grid">
                        {/* Step 1: pick session */}
                        <div className="cs-route-section">
                            <div className="cs-route-section__head">
                                <div className="cs-route-section__title">
                                    <span className="cs-route-section__num">1</span>
                                    Choose session
                                </div>
                                <div className="cs-route-toggle">
                                    <button
                                        type="button"
                                        className={`cs-route-toggle__btn${sourceMode === 'recent' ? ' cs-route-toggle__btn--active' : ''}`}
                                        onClick={() => setSourceMode('recent')}
                                    >
                                        From recent sessions
                                    </button>
                                    <button
                                        type="button"
                                        className={`cs-route-toggle__btn${sourceMode === 'manual' ? ' cs-route-toggle__btn--active' : ''}`}
                                        onClick={() => setSourceMode('manual')}
                                    >
                                        Enter ID manually
                                    </button>
                                </div>
                            </div>

                            {activeSession && (
                                <button
                                    type="button"
                                    className="cs-route-active-banner"
                                    onClick={() => {
                                        setSourceMode('recent');
                                        setSelectedSessionId(activeSession.session_id);
                                    }}
                                    title={activeSession.cwd ?? ''}
                                >
                                    <span className="cs-route-active-banner__icon">●</span>
                                    <span className="cs-route-active-banner__label">
                                        Active session{activeSession.cwd ? ` (${basename(activeSession.cwd) || activeSession.cwd})` : ''}
                                    </span>
                                    <span className="cs-route-active-banner__sid">
                                        {shortSessionId(activeSession.session_id)}
                                    </span>
                                    <span className="cs-route-active-banner__cta">
                                        {selectedSessionId === activeSession.session_id ? '✓ Selected' : 'Use now →'}
                                    </span>
                                </button>
                            )}

                            {sourceMode === 'recent' ? (
                                <>
                                    <div className="cs-route-filter-row">
                                        <input
                                            className="cs-rinput"
                                            placeholder="Search cwd / first message…"
                                            value={sessionSearch}
                                            onChange={(e) => setSessionSearch(e.target.value)}
                                        />
                                        <select
                                            className="cs-rselect"
                                            value={cwdFilter}
                                            onChange={(e) => setCwdFilter(e.target.value)}
                                        >
                                            <option value="">All projects</option>
                                            {cwdOptions.map((c) => (
                                                <option key={c} value={c}>{basename(c) || c}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {sessionsLoading ? (
                                        <div className="cs-route-loading">Loading recent sessions…</div>
                                    ) : sessionsError ? (
                                        <div className="cs-rerror">{sessionsError}</div>
                                    ) : filteredSessions.length === 0 ? (
                                        <div className="cs-route-empty">
                                            No matching sessions. Adjust search or switch to manual ID entry.
                                        </div>
                                    ) : (
                                        <div className="cs-route-session-list">
                                            {filteredSessions.map((s) => {
                                                const selected = selectedSessionId === s.session_id;
                                                return (
                                                    <button
                                                        key={s.session_id}
                                                        type="button"
                                                        className={`cs-route-session-row${selected ? ' cs-route-session-row--selected' : ''}`}
                                                        onClick={() => setSelectedSessionId(s.session_id)}
                                                    >
                                                        <div className="cs-route-session-row__top">
                                                            <span className="cs-route-session-row__time">
                                                                {formatRelativeTime(s.started_at)}
                                                            </span>
                                                            <span className="cs-route-session-row__sid">
                                                                {shortSessionId(s.session_id)}
                                                            </span>
                                                            {s.model && (
                                                                <span className="cs-rbadge cs-rbadge--mono cs-route-session-row__model">
                                                                    {s.model}
                                                                </span>
                                                            )}
                                                            <span className="cs-route-session-row__cwd" title={s.cwd ?? ''}>
                                                                {basename(s.cwd) || '—'}
                                                            </span>
                                                        </div>
                                                        {s.first_user_text && (
                                                            <div className="cs-route-session-row__preview">
                                                                {truncate(s.first_user_text, 80)}
                                                            </div>
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <>
                                    <input
                                        className="cs-rinput cs-rinput--mono"
                                        placeholder="Paste session_id (UUID, 36 chars)"
                                        value={manualSessionId}
                                        onChange={(e) => setManualSessionId(e.target.value)}
                                    />
                                    {manualSessionId && !isLikelyUuid(manualSessionId) && (
                                        <div className="cs-route-hint" style={{ color: 'var(--r-accent-amber, #f59e0b)' }}>
                                            Does not look like a UUID (36 chars, 4 hyphens).
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Step 2: pick account */}
                        <div className="cs-route-section">
                            <div className="cs-route-section__head">
                                <div className="cs-route-section__title">
                                    <span className="cs-route-section__num">2</span>
                                    Choose target account
                                </div>
                                <input
                                    className="cs-rinput"
                                    style={{ flex: '0 0 220px' }}
                                    placeholder="Search accounts…"
                                    value={accountSearch}
                                    onChange={(e) => setAccountSearch(e.target.value)}
                                />
                            </div>

                            {filteredAccounts.length === 0 ? (
                                <div className="cs-route-empty">No accounts. Add one under Accounts first.</div>
                            ) : (
                                <div className="cs-route-account-list">
                                    {filteredAccounts.map((a) => {
                                        const selected = selectedAccountId === a.id;
                                        const badge = categoryBadge(a);
                                        const health = accountHealth(a);
                                        const quota = accountQuotaSummary(a);
                                        return (
                                            <button
                                                key={a.id}
                                                type="button"
                                                className={`cs-route-account-row${selected ? ' cs-route-account-row--selected' : ''}`}
                                                onClick={() => setSelectedAccountId(a.id)}
                                            >
                                                <span className="cs-route-account-row__radio" aria-hidden />
                                                <span className="cs-route-account-row__name" title={a.name}>
                                                    {a.name}
                                                </span>
                                                <span className={badge.className}>{badge.label}</span>
                                                <span
                                                    className={`cs-route-account-row__health cs-route-account-row__health--${health}`}
                                                    title={health === 'ok' ? 'Healthy' : 'Invalid or banned'}
                                                />
                                                {quota && (
                                                    <span className="cs-route-account-row__quota" title={quota}>
                                                        {quota}
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Step 3: Notes */}
                        <div className="cs-route-section">
                            <div className="cs-route-section__head">
                                <div className="cs-route-section__title">
                                    <span className="cs-route-section__num">3</span>
                                    Label (optional)
                                </div>
                            </div>
                            <input
                                className="cs-rinput"
                                placeholder="e.g. GLM for docs"
                                value={label}
                                onChange={(e) => setLabel(e.target.value)}
                                maxLength={64}
                            />
                            <div className="cs-route-hint">Shown in Routes list for recognition.</div>
                        </div>

                        {error && <div className="cs-rerror">{error}</div>}
                    </div>
                </div>

                <div className="cs-relay-modal__footer">
                    <span style={{ fontSize: 11, color: 'var(--r-fg-muted)' }}>
                        {sessionValid && selectedAccountId
                            ? 'Ready — click Add route'
                            : 'Pick session and account to add'}
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button className="cs-rbtn cs-rbtn--ghost" onClick={onClose} disabled={submitting}>
                            Cancel
                        </button>
                        <button
                            className="cs-rbtn cs-rbtn--purple"
                            onClick={handleSubmit}
                            disabled={!canSubmit}
                        >
                            {submitting ? 'Adding…' : 'AddRoutes'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
