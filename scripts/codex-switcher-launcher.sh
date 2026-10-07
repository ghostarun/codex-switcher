#!/usr/bin/env bash
set -euo pipefail

LOG="${CODEX_SWITCHER_LAUNCH_LOG:-$HOME/.codex-switcher/gui-launch.log}"
mkdir -p "$(dirname "$LOG")"
{
  echo "=== $(date -Is) pid=$$ ==="
  echo "DISPLAY=${DISPLAY-} WAYLAND_DISPLAY=${WAYLAND_DISPLAY-} XDG_SESSION_TYPE=${XDG_SESSION_TYPE-}"
  echo "XAUTHORITY=${XAUTHORITY-}"
  echo "PATH=$PATH"
  echo "args: $*"
} >>"$LOG" 2>&1

APPDIR="${CODEX_SWITCHER_APPDIR:-$HOME/Applications/Codex-Switcher.AppDir}"
BIN="$APPDIR/usr/bin/codex-switcher"
if [[ ! -x "$BIN" ]]; then
  printf 'codex-switcher: missing English AppDir binary at %s\n' "$BIN" | tee -a "$LOG" >&2
  exit 1
fi
unset APPIMAGE APPDIR_ORIGINAL OW_NEXT || true

# If already running, do not start a second copy (it fails to bind :18080 and looks "broken").
# Match only the real binary path end-anchored (avoid matching this script / tooling).
existing="$(pgrep -f "/Applications/Codex-Switcher.AppDir/usr/bin/codex-switcher$" | head -1 || true)"
if [[ -n "${existing}" ]]; then
  cmd="$(ps -o args= -p "$existing" 2>/dev/null || true)"
  if [[ "$cmd" == *"/usr/bin/codex-switcher"* && "$cmd" != *bash* ]]; then
    echo "already running pid=$existing — raising window" >>"$LOG"
    if command -v xdotool >/dev/null 2>&1; then
      wid="$(xdotool search --name 'Codex Switcher' | head -1 || true)"
      [[ -n "$wid" ]] && xdotool windowactivate "$wid" 2>/dev/null || true
    fi
    exit 0
  fi
fi

if [[ -z "${DISPLAY:-}" ]]; then
  for d in :0 :1; do
    if [[ -S /tmp/.X11-unix/X${d#:} ]]; then
      export DISPLAY="$d"
      break
    fi
  done
fi
if [[ -z "${XAUTHORITY:-}" && -f "$HOME/.Xauthority" ]]; then
  export XAUTHORITY="$HOME/.Xauthority"
fi

if [[ -n "${DISPLAY:-}" ]]; then
  unset WAYLAND_DISPLAY || true
  export XDG_SESSION_TYPE=x11
  export GDK_BACKEND=x11
else
  export GDK_BACKEND="${GDK_BACKEND:-wayland}"
  echo "WARN: no DISPLAY; keeping Wayland" >>"$LOG"
fi

export QT_QPA_PLATFORM=xcb
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1
export WEBKIT_FORCE_SOFTWARE_RENDERING=1
export LIBGL_ALWAYS_SOFTWARE=1
export GALLIUM_DRIVER=llvmpipe
export GIO_MODULE_DIR=/dev/null
unset GIO_EXTRA_MODULES || true
export http_proxy= https_proxy= HTTP_PROXY= HTTPS_PROXY= ALL_PROXY= all_proxy=

export WEBKIT_EXEC_PATH=/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1
export LD_LIBRARY_PATH="/usr/lib/x86_64-linux-gnu:${APPDIR}/usr/lib:${APPDIR}/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export PATH="${APPDIR}/usr/bin:/usr/local/bin:/usr/bin:/bin${PATH:+:$PATH}"

export APPDIR
export GTK_DATA_PREFIX="$APPDIR"
export GTK_EXE_PREFIX="$APPDIR/usr"
export XDG_DATA_DIRS="$APPDIR/usr/share:/usr/share:${XDG_DATA_DIRS:-}"
export GSETTINGS_SCHEMA_DIR="$APPDIR/usr/share/glib-2.0/schemas"
export GDK_PIXBUF_MODULE_FILE="$APPDIR/usr/lib/x86_64-linux-gnu/gdk-pixbuf-2.0/2.10.0/loaders.cache"
export GTK_IM_MODULE_FILE="$APPDIR/usr/lib/x86_64-linux-gnu/gtk-3.0/3.0.0/immodules.cache"

echo "launch DISPLAY=$DISPLAY XAUTHORITY=$XAUTHORITY -> $BIN" >>"$LOG"
cd "$APPDIR"
exec "$BIN" "$@"
