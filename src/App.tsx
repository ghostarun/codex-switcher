import { useState, useEffect } from 'react';
import { Zap } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { effectiveKind, useAccounts } from './hooks/useAccounts';
import { useUsage } from './hooks/useUsage';
import { AddAccountModal } from './components/AddAccountModal';
import { AddRelayModal } from './components/AddRelayModal';
import { Dashboard } from './components/Dashboard';
import { AccountList } from './components/AccountList';
import { Settings } from './components/Settings';
import { Proxy } from './components/Proxy';
import { Stats } from './components/Stats';
import { Skills } from './components/Skills';
import { SessionRoutes } from './components/SessionRoutes';
import CachePanel from './components/CachePanel';
import { ConfirmModal } from './components/ConfirmModal';
import { RelayImportConfirm } from './components/RelayImportConfirm';
import './App.css';
import { ClaudeUsage } from './components/ClaudeUsage';
import { TwoPcActivity } from './components/TwoPcActivity';

type PageType = 'dashboard' | 'accounts' | 'proxy' | 'routes' | 'stats' | 'cache' | 'skills' | 'settings';

function App() {
  const {
    accounts,
    currentId,
    settings,
    loading,
    error,
    refresh,
    importCurrent,
    switchTo,
    deleteAccount,
    updateAccount,
    exportAccounts,
    reloadIdeWindows,
    updateSettings,
    checkSyncConflict,
    getSyncStatus,
    syncActiveWithDisk,
    setSessionAnchor,
  } = useAccounts();

  const {
    usage,
    loading: usageLoading,
    error: usageError,
    refresh: refreshUsage,
  } = useUsage();

  const [currentPage, setCurrentPage] = useState<PageType>(() => {
    const saved = localStorage.getItem('currentPage');
    return (saved as PageType) || 'dashboard';
  });

  // Persist current tab
  useEffect(() => {
    localStorage.setItem('currentPage', currentPage);
  }, [currentPage]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRelayModal, setShowRelayModal] = useState(false);
  const [schedulerError, setSchedulerError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(null));
  }, []);

  // Conflict modal state
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [conflictAccountName, setConflictAccountName] = useState('');
  const [pendingSwitchId, setPendingSwitchId] = useState<string | null>(null);
  const [pendingDesktopReloadId, setPendingDesktopReloadId] = useState<string | null>(null);
  const [desktopReloadError, setDesktopReloadError] = useState<string | null>(null);
  const [reloadingDesktop, setReloadingDesktop] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [proxyRunning, setProxyRunning] = useState(false);
  const [quotaWidgetVisible, setQuotaWidgetVisible] = useState(true);

  const checkProxyStatus = async () => {
    try {
      const s = await invoke<{ is_running: boolean }>('get_proxy_status');
      setProxyRunning(s.is_running);
    } catch { setProxyRunning(false); }
  };

  const checkSyncStatus = async () => {
    try {
      const status = await getSyncStatus();
      setSyncStatus(status);
    } catch (err) {
      console.error('Sync status check failed:', err);
    }
  };

  useEffect(() => {
    checkSyncStatus();
    checkProxyStatus();
  }, []);

  const currentAccount = accounts.find(a => a.id === currentId) || null;

  const classifyRefreshFailure = (reason: string): 'permanent' | 'transient' => {
    const lower = reason.toLowerCase();
    if (
      lower.includes('refresh_token_reused') ||
      lower.includes('refresh_token_invalidated') ||
      lower.includes('refresh_token_expired')
    ) {
      return 'permanent';
    }
    return 'transient';
  };

  // Background scheduler account update events
  useEffect(() => {
    const unlisten = listen('accounts-updated', () => {
      console.log('[Frontend] Background refresh — reloading accounts');
      refresh();
    });

    return () => {
      unlisten.then(f => f());
    };
  }, [refresh]);

  // Background refresh failure events
  useEffect(() => {
    const unlisten = listen<{ account_name: string; reason: string }>('token-refresh-failed', (event) => {
      const { account_name, reason } = event.payload;
      const timestamp = new Date().toLocaleTimeString();
      const kind = classifyRefreshFailure(reason);
      if (kind === 'permanent') {
        setSchedulerError(`Background keepalive stopped (${account_name}, re-login required) @ ${timestamp}`);
      } else {
        setSchedulerError(`Background keepalive transient failure (${account_name}): ${reason} @ ${timestamp}`);
      }
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  // Proxy switch/ban events
  const [proxyNotice, setProxyNotice] = useState<string | null>(null);
  useEffect(() => {
    const unsub1 = listen<string>('proxy-account-switched', (e) => {
      const msg = `Proxy auto-switched →${e.payload}`;
      setProxyNotice(msg);
      setTimeout(() => setProxyNotice(null), 8000);
      refresh();
      checkProxyStatus();
    });
    const unsub2 = listen<string>('proxy-account-banned', (e) => {
      const msg = `Ban detected:${e.payload}, auto-switched`;
      setProxyNotice(msg);
      setTimeout(() => setProxyNotice(null), 10000);
      refresh();
    });
    const unsub3 = listen<string>('proxy-all-exhausted', (e) => {
      setProxyNotice(e.payload);
      setTimeout(() => setProxyNotice(null), 15000);
    });
    return () => {
      unsub1.then(f => f());
      unsub2.then(f => f());
      unsub3.then(f => f());
    };
  }, [refresh]);

  // Settings update listener
  useEffect(() => {
    const unlisten = listen('settings-updated', () => {
      console.log('[Frontend] Settings updated — reloading');
      refresh();
      checkProxyStatus();
    });

    return () => {
      unlisten.then(f => f());
    };
  }, [refresh]);

  // Perform switch
  const performSwitch = async (id: string) => {
    await switchTo(id);
    if (accounts.find(a => a.id === id && effectiveKind(a) === 'chatgpt_oauth')) {
      setDesktopReloadError(null);
      setPendingDesktopReloadId(id);
    }
    if (settings.auto_reload_ide) {
      setTimeout(async () => {
        await reloadIdeWindows(false);
      }, 300);
    }
    setTimeout(() => {
      refreshUsage();
    }, 500);
  };

  // Switch with conflict check
  const handleSwitch = async (id: string) => {
    if (isSwitching) return;
    try {
      setIsSwitching(true);
      // 1. Check unsynced official token update
      const conflictName = await checkSyncConflict();

      if (conflictName) {
        // 2. On conflict, stash target and show modal
        setConflictAccountName(conflictName);
        setPendingSwitchId(id);
        setShowConflictModal(true);
        return;
      }

      // 3. Switch directly if no conflict
      await performSwitch(id);
    } catch (err) {
      console.error('Switch check failed:', err);
      // Attempt conservative switch
      try {
        await performSwitch(id);
      } catch (switchErr) {
        // switchTo already setError; log here too
        console.error('Conservative switch also failed:', switchErr);
      }
    } finally {
      setIsSwitching(false);
      checkSyncStatus();
    }
  };

  // Confirm overwrite
  const handleConfirmSwitch = async () => {
    if (!pendingSwitchId || isSwitching) return;
    try {
      setIsSwitching(true);
      await performSwitch(pendingSwitchId);
      setShowConflictModal(false);
      setPendingSwitchId(null);
    } catch (err) {
      console.error('Confirm switch failed:', err);
      // switchTo setError; close modal so user sees banner error
      setShowConflictModal(false);
    } finally {
      setIsSwitching(false);
      checkSyncStatus();
    }
  };

  // Sync to IDE state
  const handleFollowIdeAction = async () => {
    try {
      setIsSwitching(true);
      await syncActiveWithDisk();
      setShowConflictModal(false);
      setPendingSwitchId(null);
      await checkSyncStatus();
    } catch (err) {
      console.error('Sync IDE state failed:', err);
    } finally {
      setIsSwitching(false);
    }
  };

  // Cancel switch
  const handleCancelSwitch = () => {
    setShowConflictModal(false);
    setPendingSwitchId(null);
  };

  const handleReloadDesktop = async () => {
    if (!pendingDesktopReloadId || reloadingDesktop) return;
    setReloadingDesktop(true);
    setDesktopReloadError(null);
    try {
      await invoke<string>('open_codex_terminal', { id: pendingDesktopReloadId });
      setPendingDesktopReloadId(null);
      await refresh();
      await checkProxyStatus();
    } catch (err) {
      setDesktopReloadError(String(err));
    } finally {
      setReloadingDesktop(false);
    }
  };

  const handleExport = async () => {
    try {
      const json = await exportAccounts();
      const path = await save({
        filters: [{
          name: 'JSON',
          extensions: ['json']
        }],
        defaultPath: `codex-accounts-${new Date().toISOString().slice(0, 10)}.json`
      });

      if (path) {
        await writeTextFile(path, json);
        alert('Export successful!');
      }
    } catch (err) {
      alert('Export failed: ' + String(err));
    }
  };


  const palette = settings.theme_palette || 'obsidian';
  const isDarkPalette = palette === 'obsidian' || palette === 'midnight';

  if (loading) {
    return (
      <div className="app" data-palette={palette} data-theme={isDarkPalette ? 'dark' : undefined}>
        <div className="loading">
          <div className="spinner" />
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app" data-palette={palette} data-theme={isDarkPalette ? 'dark' : undefined}>
      {/* Top title bar */}
      <header className="app-header">
        <div className="header-left">
          <div className="app-logo">
            <Zap size={18} />
          </div>
          <h1>Codex Switcher <span className="app-version">{appVersion ? `v${appVersion}` : 'v—'}</span></h1>
          <div className={`proxy-indicator ${proxyRunning ? 'on' : 'off'}`} title={proxyRunning ? 'Proxy running' : 'Proxy not started'}>
            <span className="proxy-dot" />
            {proxyRunning ? 'Proxy ON' : 'Proxy OFF'}
          </div>
          <button className="quota-widget-toggle" onClick={async () => {
            try { setQuotaWidgetVisible(await invoke<boolean>('toggle_quota_overlay')); }
            catch (error) { console.error('Quota widget toggle failed:', error); }
          }} title="Show or hide the floating quota widget" aria-label="Toggle floating quota widget">{quotaWidgetVisible ? '▣' : '▢'}</button>
        </div>

        {/* Navigation */}
        <nav className="header-nav">
          <button
            className={`nav-item ${currentPage === 'dashboard' ? 'active' : ''}`}
            onClick={() => setCurrentPage('dashboard')}
          >
            Dashboard
          </button>
          <button
            className={`nav-item ${currentPage === 'accounts' ? 'active' : ''}`}
            onClick={() => setCurrentPage('accounts')}
          >
            Accounts
          </button>
          <button
            className={`nav-item ${currentPage === 'proxy' ? 'active' : ''}`}
            onClick={() => setCurrentPage('proxy')}
          >
            Proxy
          </button>
          <button
            className={`nav-item ${currentPage === 'routes' ? 'active' : ''}`}
            onClick={() => setCurrentPage('routes')}
          >
            Routes
          </button>
          <button
            className={`nav-item ${currentPage === 'stats' ? 'active' : ''}`}
            onClick={() => setCurrentPage('stats')}
          >
            Statistics
          </button>
          <button
            className={`nav-item ${currentPage === 'cache' ? 'active' : ''}`}
            onClick={() => setCurrentPage('cache')}
          >
            Cache
          </button>
          <button
            className={`nav-item ${currentPage === 'skills' ? 'active' : ''}`}
            onClick={() => setCurrentPage('skills')}
          >
            Skills
          </button>
          <button
            className={`nav-item ${currentPage === 'settings' ? 'active' : ''}`}
            onClick={() => setCurrentPage('settings')}
          >
            Settings
          </button>
        </nav>

        <div className="header-actions">
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            + Add Account
          </button>
          <button className="btn btn-relay" onClick={() => setShowRelayModal(true)}>
            + Add Relay
          </button>
        </div>
      </header>


      {(error || schedulerError) && (
        <div className="error-banner">
          {error && <div>{error}</div>}
          {schedulerError && <div>{schedulerError}</div>}
        </div>
      )}

      {proxyNotice && (
        <div className="proxy-notice-banner" onClick={() => setProxyNotice(null)}>
          {proxyNotice}
        </div>
      )}

      <main className="app-main">
        <TwoPcActivity />
        {currentPage === 'dashboard' ? (
          <>
          <Dashboard
            accounts={accounts}
            currentAccount={currentAccount}
            usage={usage}
            usageLoading={usageLoading}
            usageError={usageError}
            isCurrentInvalid={currentAccount?.cached_quota?.is_valid_for_cli === false}
            onSwitch={handleSwitch}
            onRefreshUsage={refreshUsage}
            onNavigateToAccounts={() => setCurrentPage('accounts')}
            onExport={handleExport}
            proxyRunning={proxyRunning}
            syncStatus={syncStatus}
            onSyncWithDisk={async () => {
              try {
                await syncActiveWithDisk();
                checkSyncStatus();
              } catch (err) {
                console.error('Sync status failed:', err);
              }
            }}
            onImportDiskAccount={async (name) => {
              try {
                await importCurrent(name, 'Import from IDE automatically');
                checkSyncStatus();
              } catch (err) {
                console.error('Import failed:', err);
              }
            }}
            onForceOverwriteDisk={async () => {
              try {
                await invoke<string>('force_overwrite_disk_with_current');
                if (settings.auto_reload_ide) {
                  await reloadIdeWindows(false);
                }
                checkSyncStatus();
                refreshUsage();
              } catch (err) {
                console.error('Failed to overwrite ~/.codex/auth.json', err);
              }
            }}
          />
          <ClaudeUsage />
          </>
        ) : currentPage === 'accounts' ? (
          <>
          <AccountList
            accounts={accounts}
            currentId={currentId}
            settings={settings}
            onSwitch={handleSwitch}
            onDelete={deleteAccount}
            onUpdateAccount={updateAccount}
            onUpdateSettings={updateSettings}
            onRefreshComplete={refresh}
            onAddAccount={() => setShowAddModal(true)}
            onAddRelay={() => setShowRelayModal(true)}
            onRefreshUsage={refreshUsage}
            usageLoading={usageLoading}
          />
          <ClaudeUsage />
          </>
        ) : currentPage === 'proxy' ? (
          <Proxy />
        ) : currentPage === 'routes' ? (
          <SessionRoutes />
        ) : currentPage === 'stats' ? (
          <Stats />
        ) : currentPage === 'cache' ? (
          <CachePanel accounts={accounts.map(a => ({ id: a.id, name: a.name }))} />
        ) : currentPage === 'skills' ? (
          <Skills />
        ) : (
          <Settings accounts={accounts} onSetSessionAnchor={setSessionAnchor} />
        )}
      </main>

      <AddAccountModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdd={importCurrent}
        onSuccess={refresh}
      />

      <AddRelayModal
        isOpen={showRelayModal}
        onClose={() => setShowRelayModal(false)}
        onSuccess={refresh}
      />

      <ConfirmModal
        isOpen={showConflictModal}
        title="⚠️ Login conflict warning"
        message={
          <>
            <p>Unsynced token update in official Codex extension.</p>
            <p>Account state differs from official file:</p>
            <span className="confirm-account-name">{conflictAccountName || 'Current Account'}</span>
            <p style={{ marginTop: '12px' }}>
              Switching will <b>overwrite</b> official plugin login; unsynced updates are lost.
            </p>
          </>
        }
        confirmText="Confirm overwrite and switch"
        cancelText="Cancel"
        onConfirm={handleConfirmSwitch}
        onCancel={handleCancelSwitch}
        isLoading={isSwitching}
        extraActionText="Use IDE state (sync)"
        onExtraAction={handleFollowIdeAction}
      />

      <ConfirmModal
        isOpen={pendingDesktopReloadId !== null}
        title="Reload Codex Desktop?"
        message={<>
          <p>Switcher is now set to <b>{accounts.find(a => a.id === pendingDesktopReloadId)?.name}</b>. Codex Desktop may still be using its previous session.</p>
          <p>Reloading will close and reopen Codex Desktop, interrupting any active work. With a phone anchor, its login stays on disk and the selected account uses the local proxy.</p>
          {desktopReloadError && <p role="alert">Reload failed: {desktopReloadError}</p>}
        </>}
        confirmText="Reload Codex Desktop"
        cancelText="Later"
        onConfirm={handleReloadDesktop}
        onCancel={() => { setPendingDesktopReloadId(null); setDesktopReloadError(null); }}
        isLoading={reloadingDesktop}
      />

      <RelayImportConfirm />
    </div>
  );
}

export default App;
