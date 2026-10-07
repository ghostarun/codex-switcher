#!/usr/bin/env python3
"""Install a locally built personal Switcher after handing off active work."""
import argparse, hashlib, json, os, secrets, shutil, subprocess, sys, time
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent

def write(path, data, mode=0o600):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_name(path.name+'.install-tmp')
    temp.write_bytes(data)
    temp.chmod(mode)
    temp.replace(path)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--binary',type=Path,required=True)
    p.add_argument('--peer-ip',choices=['100.104.44.67','100.95.7.78'],required=True)
    p.add_argument('--secret-file',type=Path,required=True,help='same private pairing-secret file on both PCs; created if missing')
    a=p.parse_args()
    if subprocess.run(['pgrep','-u',str(os.getuid()),'-x','codex-switcher'],capture_output=True).returncode==0:
        sys.exit('Switcher is still running. Hand off active work and quit it before installing; no processes were stopped.')
    ts=json.loads(subprocess.check_output(['tailscale','status','--json'],text=True,timeout=5))
    own=next((ip for ip in ts.get('Self',{}).get('TailscaleIPs',[]) if ip in ['100.104.44.67','100.95.7.78']),None)
    if not own or own==a.peer_ip or ts.get('Self',{}).get('OS')!='linux':
        sys.exit('Pairing is limited to Linux ThinkStation P3 and Linux Legion; choose the other PC.')
    binary=a.binary.expanduser().resolve()
    checked=subprocess.run(['ldd',str(binary)],capture_output=True,text=True)
    if checked.returncode or 'not found' in checked.stdout+checked.stderr:
        sys.exit('Binary dependencies are incompatible with this PC. Build from this source on this PC before installing.')
    home=Path.home(); appdir=home/'Applications/Codex-Switcher.AppDir'
    if not appdir.is_dir():
        if not Path('/opt/codex-switcher').is_dir(): sys.exit('Existing Switcher AppDir is required; install the base app first.')
        shutil.copytree('/opt/codex-switcher',appdir,symlinks=True)
    secret_file=a.secret_file.expanduser()
    secret=secret_file.read_text().strip() if secret_file.exists() else secrets.token_urlsafe(32)
    if len(secret)<32: sys.exit('Pairing secret must contain at least 32 characters.')
    accounts=home/'.codex-switcher/accounts.json'
    if not accounts.is_file(): sys.exit('Existing Switcher accounts are required before pairing.')
    data=json.loads(accounts.read_text())
    settings=data.setdefault('settings',{})
    settings.update(two_pc_enabled=True,two_pc_peer_ip=a.peer_ip,two_pc_secret=secret,
                    two_pc_primary=own=='100.104.44.67',two_pc_prefer_separate=True,solo_auto_sync_current=False)
    if settings.get('remote_mode')=='solo': sys.exit('Migrate legacy solo to client mode before installing pairing.')
    if settings.get('remote_mode')=='client': settings.update(client_owns_current=True,client_direct_upstream=True,background_refresh=False)
    stamp=time.strftime('%Y%m%d-%H%M%S')
    target=appdir/'usr/bin/codex-switcher'
    if target.exists(): shutil.copy2(target,target.with_name('codex-switcher.bak-'+stamp))
    write(target,binary.read_bytes(),0o755)
    write(appdir/'usr/bin/xdg-open',(ROOT/'scripts/xdg-open-desktop').read_bytes(),0o755)
    launcher=(ROOT/'scripts/codex-switcher-launcher.sh').read_text()
    launcher=launcher.replace('pgrep -f "/Applications/Codex-Switcher.AppDir/usr/bin/codex-switcher$"','pgrep -u "$(id -u)" -x codex-switcher')
    write(home/'.local/bin/codex-switcher',launcher.encode(),0o755)
    write(home/'.local/bin/codex_switcher',(ROOT/'scripts/codex_switcher').read_bytes(),0o755)
    write(secret_file,(secret+'\n').encode())
    shutil.copy2(accounts,accounts.with_name('accounts.json.bak-two-pc-'+stamp))
    write(accounts,(json.dumps(data,indent=2)+'\n').encode())
    version=json.loads((ROOT/'package.json').read_text())['version']
    write(home/'.codex-switcher/installed-build.json',(json.dumps({'version':version,'protocol_version':1,'binary':str(target),'sha256':hashlib.sha256(target.read_bytes()).hexdigest()},indent=2)+'\n').encode())
    t3_launcher=home/'.local/bin/t3code'
    if t3_launcher.is_file():
        t3_text=t3_launcher.read_text()
        if 'import os, pathlib, sys\n' in t3_text and 'T3CODE_SWITCHER_LAUNCHER' not in t3_text:
            shutil.copy2(t3_launcher,t3_launcher.with_name('t3code.bak-switcher-'+stamp))
            t3_text=t3_text.replace('import os, pathlib, sys\n','import os, pathlib, sys\nos.environ.setdefault("T3CODE_SWITCHER_LAUNCHER", str(pathlib.Path.home() / ".local/bin/codex-switcher"))\nos.environ.setdefault("T3CODE_SWITCHER_BINARY", str(pathlib.Path.home() / "Applications/Codex-Switcher.AppDir/usr/bin/codex-switcher"))\n')
            write(t3_launcher,t3_text.encode(),0o755)
    applications=home/'.local/share/applications'
    entry='[Desktop Entry]\nType=Application\nName=Codex Switcher Personal\nExec="'+str(home/'.local/bin/codex-switcher')+'"\nTerminal=false\nCategories=Development;\nIcon=utilities-terminal\n'
    write(applications/'codex-switcher.desktop',entry.encode(),0o644)
    print(f'Installed Switcher {version}; paired with {a.peer_ip}. Start with codex-switcher after safe handoff.')
    print(f'Pairing secret is in {secret_file}; transfer this file privately to the other PC. It was not printed.')
if __name__=='__main__':
    try: main()
    except (OSError,ValueError,subprocess.SubprocessError) as e: sys.exit(str(e))
