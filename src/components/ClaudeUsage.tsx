import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './UsageCard.css';

type Usage = { account: string; plan: string; updated_at: string; windows: { label: string; used_percent: number; resets_at: string | null }[] };
export function ClaudeUsage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const refresh = async (force = false) => {
    setLoading(true);
    try { setUsage(await invoke<Usage>('get_claude_usage', { force })); setError(null); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 300_000); return () => clearInterval(timer); }, []);
  return <section className="settings-section" aria-label="Claude usage" style={{ marginTop: 20 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <h3>Claude usage &amp; quota</h3>
      <button className="btn btn-ghost btn-sm" disabled={loading} onClick={() => void refresh(true)}>{loading ? 'Loading…' : 'Refresh'}</button>
    </div>
    {error && <p role="status">{error}{usage ? ' Showing the last successful update below.' : ''}</p>}
    {usage && <>
      <p>{usage.account} · {usage.plan} plan</p>
      <div className="usage-meters">{usage.windows.map(w => {
        const left = Math.max(0, 100 - w.used_percent);
        const reset = w.resets_at && Number.isFinite(Date.parse(w.resets_at)) ? new Date(w.resets_at).toLocaleString() : null;
        return <div key={w.label}>
          <div className="usage-row"><span className="usage-label">{w.label}</span><span>{w.used_percent.toFixed(1)}% used · {left.toFixed(1)}% left</span></div>
          <progress value={Math.min(100, w.used_percent)} max={100} aria-label={`${w.label} usage`} style={{ width: '100%' }} />
          {reset && <div className="usage-reset">Resets {reset}</div>}
        </div>;
      })}</div>
      <small>Last successful update: {new Date(usage.updated_at).toLocaleString()}</small>
    </>}
  </section>;
}
