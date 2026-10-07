import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

type Identity = { key: string; name: string };
type Node = { live_accounts: { account: Identity; connections: number; since: number }[]; switcher_version: string; t3_version: string | null; protocol_version: number; name: string; ip: string; primary: boolean; proxy_running: boolean; selected: Identity | null; last_served: Identity | null; last_request_at: number | null };
type Status = { enabled: boolean; prefer_separate: boolean; local: Node; peer: Node | null; peer_ip: string; peer_online: boolean; sharing: boolean; error: string | null };
export function TwoPcActivity() {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    let stopped = false;
    const refresh = () => invoke<Status>('get_two_pc_status').then(s => { if (!stopped) setStatus(s); }).catch(() => {});
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => { stopped = true; clearInterval(timer); };
  }, []);
  if (!status?.enabled) return null;
  const node = (n: Node, local: boolean) => <div key={local ? 'local' : 'peer'} style={{ padding: '8px 0' }}>
    <strong>{n.name || (local ? 'This PC' : 'Other PC')}</strong> {local ? '(this PC)' : ''} · {n.ip} · {n.proxy_running ? 'proxy running' : 'proxy stopped'}{n.primary ? ' · idle tie preference' : ''}
    <div style={{ opacity: 0.7 }}>Switcher {n.switcher_version} · T3 Personal {n.t3_version ?? 'not detected'}</div>
    <div>Live connections: {n.live_accounts.map(a => `${a.account.name} (${a.connections})`).join(', ') || 'none'}</div>
    <div>Selected: {n.selected?.name ?? 'No account selected'}</div>
    <div style={{ opacity: 0.7 }}>Last served: {n.last_served?.name ?? 'No request recorded since startup'}{n.last_request_at ? ` · ${new Date(n.last_request_at * 1000).toLocaleString()}` : ''}</div>
  </div>;
  return <section className="settings-section" style={{ marginBottom: 20 }} aria-label="Two-PC activity">
    <h3>Two-PC activity</h3>
    {node(status.local, true)}
    {status.peer ? node(status.peer, false) : <div>{status.peer_ip}: {status.peer_online ? 'Tailscale online; Switcher activity unavailable' : 'Offline or not connected to Tailscale'}</div>}
    {status.sharing && <div>Both PCs selected the same account{status.prefer_separate ? '; sharing until another usable account is available.' : '.'}</div>}
    {status.peer && (status.peer.switcher_version !== status.local.switcher_version || status.peer.t3_version !== status.local.t3_version) && <div role="status">Versions differ between PCs. Run the personal DentoBot tools check before handoff.</div>}
    {status.error && <div role="status">{status.error}</div>}
  </section>;
}
