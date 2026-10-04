import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { useAccounts, Account, effectiveKind } from '../hooks/useAccounts';
import {
    SessionRoute,
    shortSessionId,
    formatRelativeTime,
} from '../data/session_routes';
import { AddRouteModal } from './AddRouteModal';
import { ConfirmModal } from './ConfirmModal';
import './SessionRoutes.css';

function accountBadge(account: Account | undefined): { label: string; className: string } | null {
    if (!account) return null;
    const kind = effectiveKind(account);
    if (kind === 'chatgpt_oauth') return { label: 'Subscription', className: 'badge kind-chatgpt' };
    if (kind === 'openai_key') return { label: 'API', className: 'badge kind-openai' };
    switch (account.relay_category) {
        case 'coding_plan':
            return { label: 'Plan', className: 'badge kind-codingplan' };
        case 'third_party':
            return { label: 'Third-party', className: 'badge kind-thirdparty' };
        case 'aggregator':
        default:
            return { label: 'Relay', className: 'badge kind-relay' };
    }
}

function accountWarning(account: Account | undefined): string | null {
    if (!account) return 'Target account was deleted';
    const flags: string[] = [];
    if (account.is_banned) flags.push('Banned');
    if (account.is_token_invalid) flags.push('Token invalid');
    if (account.is_logged_out) flags.push('Re-login required');
    return flags.length ? `Target account issue: ${flags.join(' · ')}` : null;
}

export function SessionRoutes() {
    const { accounts } = useAccounts();

    const [routes, setRoutes] = useState<SessionRoute[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [search, setSearch] = useState('');
    const [showAddModal, setShowAddModal] = useState(false);

    // copy-feedback id
    const [copiedId, setCopiedId] = useState<string | null>(null);

    // edit-label inline modal
    const [editTarget, setEditTarget] = useState<SessionRoute | null>(null);
    const [editLabel, setEditLabel] = useState('');
    const [editSaving, setEditSaving] = useState(false);

    // delete confirm
    const [deleteTarget, setDeleteTarget] = useState<SessionRoute | null>(null);
    const [deleting, setDeleting] = useState(false);

    const accountMap = useMemo(() => {
        const m = new Map<string, Account>();
        for (const a of accounts) m.set(a.id, a);
        return m;
    }, [accounts]);

    const load = useCallback(async () => {
        setError(null);
        try {
            const rows = await invoke<SessionRoute[]>('list_session_routes');
            setRoutes(rows);
        } catch (e) {
            setError(typeof e === 'string' ? e : String(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    // Search across label / session_id / cwd. cwd lives only on CodexSession
    // (not on SessionRoute), so this is "label + session_id + target account
    // name" in practice. Spec says cwd, but we don't have it without an extra
    // RPC; matching against the joined account name gives a similar feel.
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return routes;
        return routes.filter((r) => {
            const acc = accountMap.get(r.account_id);
            const hay = `${r.label ?? ''} ${r.session_id} ${acc?.name ?? ''}`.toLowerCase();
            return hay.includes(q);
        });
    }, [routes, search, accountMap]);

    const enabledCount = useMemo(() => routes.filter((r) => r.enabled).length, [routes]);

    const handleToggle = async (route: SessionRoute) => {
        // Optimistic update.
        const next = !route.enabled;
        setRoutes((prev) => prev.map((r) => (r.id === route.id ? { ...r, enabled: next } : r)));
        try {
            await invoke('toggle_session_route', { id: route.id, enabled: next });
        } catch (e) {
            // Roll back.
            setRoutes((prev) => prev.map((r) => (r.id === route.id ? { ...r, enabled: route.enabled } : r)));
            setError(typeof e === 'string' ? e : String(e));
        }
    };

    const handleCopySid = async (route: SessionRoute) => {
        try {
            await navigator.clipboard.writeText(route.session_id);
            setCopiedId(route.id);
            setTimeout(() => setCopiedId((cur) => (cur === route.id ? null : cur)), 1500);
        } catch (e) {
            console.error('copy failed', e);
        }
    };

    const openEdit = (route: SessionRoute) => {
        setEditTarget(route);
        setEditLabel(route.label ?? '');
    };

    const submitEdit = async () => {
        if (!editTarget) return;
        const newLabel = editLabel.trim() || null;
        setEditSaving(true);
        try {
            await invoke('update_session_route_label', { id: editTarget.id, label: newLabel });
            setRoutes((prev) => prev.map((r) => (r.id === editTarget.id ? { ...r, label: newLabel } : r)));
            setEditTarget(null);
        } catch (e) {
            setError(typeof e === 'string' ? e : String(e));
        } finally {
            setEditSaving(false);
        }
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await invoke('delete_session_route', { id: deleteTarget.id });
            setRoutes((prev) => prev.filter((r) => r.id !== deleteTarget.id));
            setDeleteTarget(null);
        } catch (e) {
            setError(typeof e === 'string' ? e : String(e));
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div className="sr-page">
            <div className="sr-topbar">
                <div className="sr-topbar__left">
                    <button className="sr-btn-add" onClick={() => setShowAddModal(true)}>
                        + Add route
                    </button>
                </div>
                <input
                    className="sr-topbar__search"
                    placeholder="Search label / session_id / account…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                <div className="sr-topbar__right">
                    <button
                        className="sr-iconbtn"
                        onClick={load}
                        disabled={loading}
                        title="Refresh"
                    >
                        <RefreshCw size={14} />
                    </button>
                    <span className="sr-topbar__count">
                        <strong>{routes.length}</strong> rule(s), <strong>{enabledCount}</strong> enabled
                    </span>
                </div>
            </div>

            {error && <div className="sr-error">{error}</div>}

            {loading ? (
                <div className="sr-empty">Loading route rules…</div>
            ) : routes.length === 0 ? (
                <div className="sr-empty">
                    No route rules yet. Click <strong>+ Add</strong>.
                    <br />
                    Pin a codex session to an account; bypass global auto-switch.
                </div>
            ) : filtered.length === 0 ? (
                <div className="sr-empty">No rules match "{search}".</div>
            ) : (
                <div className="sr-list">
                    {filtered.map((r) => {
                        const acc = accountMap.get(r.account_id);
                        const badge = accountBadge(acc);
                        const warning = accountWarning(acc);
                        const label = r.label || shortSessionId(r.session_id);
                        return (
                            <div
                                key={r.id}
                                className={`sr-card${r.enabled ? '' : ' sr-card--disabled'}`}
                            >
                                <div className="sr-card__row1">
                                    <label className="sr-switch" title={r.enabled ? 'Enabled' : 'Disabled'}>
                                        <input
                                            type="checkbox"
                                            checked={r.enabled}
                                            onChange={() => handleToggle(r)}
                                        />
                                        <span className="sr-switch__slider" />
                                    </label>
                                    <span className="sr-card__label" title={r.label ?? r.session_id}>
                                        {label}
                                    </span>
                                    <div className="sr-card__actions">
                                        <button
                                            className="sr-iconbtn"
                                            onClick={() => openEdit(r)}
                                            title="Edit label"
                                        >
                                            <Pencil size={13} />
                                        </button>
                                        <button
                                            className="sr-iconbtn"
                                            onClick={() => setDeleteTarget(r)}
                                            title="Delete route"
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                </div>

                                <div className="sr-card__row2">
                                    <span>session:</span>
                                    <span
                                        className={`sr-card__sid${copiedId === r.id ? ' sr-card__sid--copied' : ''}`}
                                        onClick={() => handleCopySid(r)}
                                        title="Click to copy full session_id"
                                    >
                                        {copiedId === r.id ? 'Copied ✓' : r.session_id}
                                    </span>
                                </div>

                                <div className="sr-card__row3">
                                    <span className="sr-card__arrow">→</span>
                                    {acc ? (
                                        <>
                                            <span className="sr-card__account-name">{acc.name}</span>
                                            {badge && <span className={badge.className}>{badge.label}</span>}
                                        </>
                                    ) : (
                                        <span className="sr-card__account-missing">
                                            Unknown account (deleted? id:{r.account_id.slice(0, 8)})
                                        </span>
                                    )}
                                </div>

                                <div className="sr-card__row4">
                                    <span>{r.hit_count} hit(s)</span>
                                    <span className="sr-card__meta-sep">·</span>
                                    <span>Last {r.last_hit_at ? formatRelativeTime(r.last_hit_at) : 'never'}</span>
                                    <span className="sr-card__meta-sep">·</span>
                                    <span>Created {formatRelativeTime(r.created_at)}</span>
                                </div>

                                {warning && <div className="sr-card__warn">{warning}</div>}
                            </div>
                        );
                    })}
                </div>
            )}

            <AddRouteModal
                isOpen={showAddModal}
                accounts={accounts}
                onClose={() => setShowAddModal(false)}
                onSuccess={() => {
                    load();
                }}
            />

            {/* Inline edit-label modal */}
            {editTarget && (
                <div className="sr-edit-modal__overlay" onClick={() => !editSaving && setEditTarget(null)}>
                    <div className="sr-edit-modal__panel" onClick={(e) => e.stopPropagation()}>
                        <div className="sr-edit-modal__title">Edit label</div>
                        <input
                            className="sr-edit-modal__input"
                            placeholder="e.g. GLM for docs"
                            value={editLabel}
                            onChange={(e) => setEditLabel(e.target.value)}
                            maxLength={64}
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') submitEdit();
                                if (e.key === 'Escape') setEditTarget(null);
                            }}
                        />
                        <div className="sr-edit-modal__footer">
                            <button
                                className="sr-btn-ghost"
                                onClick={() => setEditTarget(null)}
                                disabled={editSaving}
                            >
                                Cancel
                            </button>
                            <button
                                className="sr-btn-confirm"
                                onClick={submitEdit}
                                disabled={editSaving}
                            >
                                {editSaving ? 'Saving…' : 'Save'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete confirm */}
            <ConfirmModal
                isOpen={!!deleteTarget}
                title="Confirm delete route"
                message={
                    <>
                        <p>Confirm delete route "{deleteTarget?.label || shortSessionId(deleteTarget?.session_id ?? '')}"?</p>
                        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 8 }}>
                            After delete this session uses global auto-switch again.
                        </p>
                    </>
                }
                confirmText="Delete"
                cancelText="Cancel"
                onConfirm={confirmDelete}
                onCancel={() => setDeleteTarget(null)}
                isLoading={deleting}
            />
        </div>
    );
}

export default SessionRoutes;
