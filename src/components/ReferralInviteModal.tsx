import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface Grant { recipient?: string; grant_type?: string; amount?: number }
interface Offer {
    should_show?: boolean;
    offer_id?: string | null;
    grants?: Grant[];
    remaining_send_capacity?: number;
    remaining_reward_capacity?: number;
    requires_explicit_confirmation?: boolean;
}
interface Invite { email?: string; referral_id?: string; invite_url?: string; status?: string }
interface Tracking { items: Invite[]; cursor?: string | null }
interface Result { invites: Invite[]; failed_emails?: string[]; grants?: Grant[]; offer_id?: string; message?: string }

function reward(offer: Offer): string {
    const grants = (offer.grants ?? []).filter(g => g.recipient === 'referrer' && (g.amount ?? 0) > 0);
    if (grants.length) return grants.map(g => {
        const unit = g.grant_type === 'personal_credits' ? ' usage quota(s)'
            : g.grant_type === 'workspace_credits' ? ' workspace quota(s)'
                : g.grant_type?.includes('rate_limit_reset') ? ' quota reset(s)' : ` (${g.grant_type ?? 'reward'})`;
        return `${g.amount?.toLocaleString()} ${unit}`;
    }).join(' + ');
    if (!offer.grants?.length) {
        const amount = { credits_250: 250, credits_500: 500, credits_1000: 1000 }[offer.offer_id ?? ''];
        if (amount) return `${amount.toLocaleString()}  usage quota(s)`;
    }
    return 'Reward amount not provided';
}

function capacity(offer: Offer | null): number {
    if (!offer?.should_show) return 0;
    let cap = Math.min(5, offer.remaining_send_capacity ?? 0);
    if (offer.grants?.length || (offer.offer_id != null && offer.offer_id !== 'none'))
        cap = Math.min(cap, offer.remaining_reward_capacity ?? 0);
    return Math.max(0, cap);
}

export function ReferralInviteModal({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
    const [program, setProgram] = useState('codex_referral_consumer');
    const [offer, setOffer] = useState<Offer | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [input, setInput] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    const [sending, setSending] = useState(false);
    const [result, setResult] = useState<Result | null>(null);
    const [records, setRecords] = useState<Invite[]>([]);
    const [cursor, setCursor] = useState<string | null>(null);
    const [trackingLoading, setTrackingLoading] = useState(false);
    const [trackingLoaded, setTrackingLoaded] = useState(false);
    const [trackingError, setTrackingError] = useState('');
    const [submitted, setSubmitted] = useState(false);
    const generation = useRef(0);
    const sendLock = useRef(false);

    async function refreshOffer() {
        const gen = ++generation.current;
        setLoading(true); setError(''); setOffer(null); setConfirmed(false);
        try {
            const data = await invoke<Offer>('get_desktop_referral_eligibility', { id, program });
            if (gen === generation.current) setOffer(data);
        } catch (e) { if (gen === generation.current) setError(String(e)); }
        finally { if (gen === generation.current) setLoading(false); }
    }
    useEffect(() => {
        setInput(''); setResult(null); setRecords([]); setCursor(null);
        setTrackingLoaded(false); setTrackingError(''); setSubmitted(false);
        void refreshOffer();
        return () => { generation.current++; };
    }, [id, program]);

    async function tracking(more = false) {
        const gen = generation.current;
        setTrackingLoading(true); setTrackingError('');
        try {
            const data = await invoke<Tracking>('get_desktop_referral_tracking', { id, program, cursor: more ? cursor : null });
            if (gen !== generation.current) return;
            setRecords(prev => more ? [...prev, ...data.items] : data.items);
            setCursor(data.cursor ?? null); setTrackingLoaded(true);
        } catch (e) { if (gen === generation.current) setTrackingError(String(e)); }
        finally { setTrackingLoading(false); }
    }
    const emails = [...new Map(input.split(/[\s,;]+/).filter(Boolean).map(e => [e.toLowerCase(), e])).values()];
    const cap = capacity(offer);
    const valid = emails.length > 0 && emails.length <= cap && emails.every(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    const ready = valid && !!offer && (offer.requires_explicit_confirmation === false || confirmed);
    async function send() {
        if (!ready || sendLock.current || submitted) return;
        sendLock.current = true; setSending(true); setSubmitted(true); setError('');
        try {
            setResult(await invoke<Result>('send_desktop_referral_invite', { id, program, emails, expected: offer }));
            await tracking();
        } catch (e) { setError(String(e)); }
        finally { setSending(false); sendLock.current = false; }
    }
    return <div className="modal-overlay" onClick={() => !sending && onClose()}>
        <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxHeight: '85vh', overflowY: 'auto' }}>
            <div className="modal-header"><div className="header-top">
                <h2>Invite to ChatGPT desktop</h2>
                <button className="close-btn" onClick={onClose} disabled={sending}>×</button>
            </div></div>
            <div className="modal-body">
                <p className="modal-tip">Inviting from: <strong>{name}</strong></p>
                <label>Program <select value={program} onChange={e => setProgram(e.target.value)} disabled={sending || loading || trackingLoading}>
                    <option value="codex_referral_consumer">Personal account</option>
                    <option value="codex_referral_workspace">Workspace</option>
                </select></label>
                <button className="btn btn-ghost btn-sm" onClick={() => void refreshOffer()} disabled={loading || sending || trackingLoading}>Refresh eligibility</button>
                {loading && <p role="status">Checking eligibility…</p>}
                {offer && <div className="invite-result-card">
                    <div><strong>{offer.should_show ? `Reward per eligible invite: ${reward(offer)}` : 'Invite not available for current account'}</strong>
                        <p>Up to {cap} email(s) this batch; reward slots left: {offer.remaining_reward_capacity ?? 'Not provided'}</p>
                        <p>Promotional reward amount, not current balance. Rewards credit after invitee accepts and meets official requirements.</p>
                    </div>
                </div>}
                <textarea aria-label="Invitee email" value={input} onChange={e => setInput(e.target.value)} rows={3}
                    placeholder="One email per line, or comma-separated" style={{ width: '100%', marginTop: 12 }} disabled={sending || submitted} />
                {input && !valid && <p role="alert">Check email format and batch size (max {cap}).</p>}
                {offer && offer.requires_explicit_confirmation !== false && <label>
                    <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={sending || submitted} />
                    I confirm recipients and reward terms. Sending does not mean rewards are credited yet.
                </label>}
                {error && <div className="invite-result-card err" role="alert">{error}</div>}
                {result && <div role="status">
                    {result.invites.length > 0 && <p>Upstream created {result.invites.length} invite(s). Delivery and rewards per official records.</p>}
                    {result.grants && <p>This batch reward: {reward(result)}</p>}
                    {result.invites.map((v, i) => <div className="invite-result-card ok" key={v.referral_id || i}>{v.email || 'Invite record created'}</div>)}
                    {!!result.failed_emails?.length && <div className="invite-result-card err">Failed: {result.failed_emails.join(', ')} {result.message}</div>}
                    {!result.invites.length && !result.failed_emails?.length && <p>No invites returned — check tracking records.</p>}
                </div>}
                {submitted && <p>This submission is done. To invite again, review records, close, and reopen this window.</p>}
                <hr />
                <button className="btn btn-ghost" onClick={() => void tracking()} disabled={trackingLoading || sending || loading}>
                    {trackingLoading ? 'Querying…' : 'Query invites (last 90 days)'}
                </button>
                {trackingError && <p role="alert">{trackingError}</p>}
                {trackingLoaded && !records.length && <p>No invite records in the last 90 days.</p>}
                {records.map((v, i) => <div className="invite-result-card" key={`${v.referral_id}-${i}`}>
                    <span>{v.email || '—'}</span> <span>{v.status || 'Status not provided by upstream'}</span>
                </div>)}
                {cursor && <button className="btn btn-ghost" onClick={() => void tracking(true)} disabled={trackingLoading || sending || loading}>Load more</button>}
            </div>
            <div className="modal-footer">
                <button className="btn btn-ghost" onClick={onClose} disabled={sending}>Close</button>
                <button className="btn btn-primary" onClick={() => void send()} disabled={!ready || sending || loading || submitted}>
                    {sending ? 'Sending…' : 'Send invite'}
                </button>
            </div>
        </div>
    </div>;
}
