use std::{
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        OnceLock,
    },
    thread,
    time::Duration,
};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIcon, TrayIconBuilder, TrayIconEvent},
    webview::WebviewWindowBuilder,
    AppHandle, Manager,
};

static QUOTA_OVERLAY_ENABLED: AtomicBool = AtomicBool::new(true);
static QUOTA_FOCUS_MONITOR: OnceLock<()> = OnceLock::new();
static TRAY_QUOTA_SUMMARY: OnceLock<tauri::menu::MenuItem<tauri::Wry>> = OnceLock::new();

/// 初始化系统托盘
pub fn init(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // 加载并缩放图标
    let icon_bytes = include_bytes!("../icons/app-icon-squircle.png");
    let base_img =
        image::load_from_memory(icon_bytes).map_err(|e| format!("Failed to load icon: {}", e))?;

    let target_size = 128;
    let content_size = 105;
    let padding = (target_size - content_size) / 2;

    let scaled_content = base_img.resize(
        content_size,
        content_size,
        image::imageops::FilterType::Lanczos3,
    );
    let mut final_img = image::RgbaImage::new(target_size, target_size);

    image::imageops::overlay(
        &mut final_img,
        &scaled_content,
        padding as i64,
        padding as i64,
    );

    let (width, height) = final_img.dimensions();
    let icon = Image::new_owned(final_img.into_raw(), width, height);

    // Windows 右键需要真正挂载 native menu；仅监听 TrayIconEvent 会把右键
    // 也当成 popup 点击，系统不会自动生成完整托盘菜单。
    let show_main = MenuItem::with_id(
        app,
        "tray-show-main",
        "Open main window",
        true,
        None::<&str>,
    )?;
    let quota_summary = MenuItem::with_id(
        app,
        "tray-quota-summary",
        "Selected · quota loading…",
        false,
        None::<&str>,
    )?;
    let _ = TRAY_QUOTA_SUMMARY.set(quota_summary.clone());
    let next_account = MenuItem::with_id(
        app,
        "tray-next-account",
        "Switch to next account",
        true,
        None::<&str>,
    )?;
    let quota_overlay = MenuItem::with_id(
        app,
        "tray-quota-overlay",
        "Toggle floating quota widget",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quota_separator = PredefinedMenuItem::separator(app)?;
    let quit = PredefinedMenuItem::quit(app, Some("Quit"))?;
    let force_quit = MenuItem::with_id(
        app,
        "tray-force-quit",
        "Force quit Codex Switcher",
        true,
        None::<&str>,
    )?;
    let menu = Menu::with_items(
        app,
        &[
            &quota_summary,
            &quota_separator,
            &show_main,
            &quota_overlay,
            &next_account,
            &separator,
            &quit,
            &force_quit,
        ],
    )?;

    let _tray = TrayIconBuilder::with_id("main")
        .icon(icon)
        .icon_as_template(false)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-show-main" => show_main_window_from_cmd(app),
            "tray-quota-overlay" => {
                let _ = toggle_quota_overlay(app);
            }
            "tray-next-account" => {
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let state = app_handle.state::<crate::AppState>();
                    let call_handle = app_handle.clone();
                    if let Err(error) =
                        crate::switch_to_next_account_internal(state, call_handle).await
                    {
                        eprintln!("[Tray] Failed to switch to next account: {}", error);
                    }
                });
            }
            "tray-force-quit" => {
                eprintln!("[Tray] Force quit requested — killing other instances, then exiting");
                let my_pid = std::process::id();
                let _ = std::process::Command::new("sh")
                    .arg("-c")
                    .arg(format!(
                        r#"for p in $(pgrep -x codex-switcher 2>/dev/null); do
                             [ "$p" != "{pid}" ] && kill -9 "$p" 2>/dev/null
                           done"#,
                        pid = my_pid
                    ))
                    .status();
                // Graceful exit on this process so Exit hooks can restore anchor disk.
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray: &TrayIcon, event: TrayIconEvent| {
            if let TrayIconEvent::Click {
                button_state: tauri::tray::MouseButtonState::Up,
                button: tauri::tray::MouseButton::Left,
                position,
                ..
            } = event
            {
                // 左键 → 弹出 popup；右键交给 native menu（Windows 修复）。
                toggle_popup(tray.app_handle(), position);
            }
        })
        .build(app)?;

    update_tray_menu(app);
    println!("[Tray] System tray started");
    Ok(())
}

pub fn show_quota_overlay(app: &AppHandle) -> Result<(), String> {
    QUOTA_OVERLAY_ENABLED.store(true, Ordering::Relaxed);
    if app.get_webview_window("quota-overlay").is_none() {
        let mut builder = WebviewWindowBuilder::new(
            app,
            "quota-overlay",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .title("Codex Quota")
        .inner_size(174.0, 60.0)
        .min_inner_size(174.0, 60.0)
        .max_inner_size(174.0, 60.0)
        .resizable(true)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false);
        if let Ok(Some(monitor)) = app.primary_monitor() {
            let scale = monitor.scale_factor();
            builder = builder.position(
                (monitor.position().x as f64 + monitor.size().width as f64) / scale - 260.0,
                monitor.position().y as f64 / scale + 72.0,
            );
        }
        builder.build().map_err(|e| e.to_string())?;
    }
    monitor_quota_overlay_focus(app);
    Ok(())
}

pub fn toggle_quota_overlay(app: &AppHandle) -> Result<bool, String> {
    let enabled = !QUOTA_OVERLAY_ENABLED.fetch_xor(true, Ordering::Relaxed);
    if enabled {
        show_quota_overlay(app)?;
    } else if let Some(window) = app.get_webview_window("quota-overlay") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(enabled)
}

fn monitor_quota_overlay_focus(app: &AppHandle) {
    QUOTA_FOCUS_MONITOR.get_or_init(|| {
        let app = app.clone();
        thread::spawn(move || {
            let mut last_visibility = None;
            loop {
                let show = QUOTA_OVERLAY_ENABLED.load(Ordering::Relaxed) && codex_window_focused();
                if last_visibility != Some(show) {
                    if let Some(window) = app.get_webview_window("quota-overlay") {
                        if show {
                            let _ = window.show();
                        } else {
                            let _ = window.hide();
                        }
                    }
                    last_visibility = Some(show);
                }
                thread::sleep(Duration::from_millis(700));
            }
        });
    });
}

#[cfg(target_os = "linux")]
fn codex_window_focused() -> bool {
    let Ok(active) = Command::new("xprop")
        .args(["-root", "_NET_ACTIVE_WINDOW"])
        .output()
    else {
        return false;
    };
    let active = String::from_utf8_lossy(&active.stdout);
    let Some(id) = active
        .split('#')
        .nth(1)
        .and_then(|s| s.split_whitespace().next())
    else {
        return false;
    };
    let Ok(class) = Command::new("xprop").args(["-id", id, "WM_CLASS"]).output() else {
        return false;
    };
    let class = String::from_utf8_lossy(&class.stdout).to_ascii_lowercase();
    class.contains("codex") || class.contains("chatgpt")
}

#[cfg(not(target_os = "linux"))]
fn codex_window_focused() -> bool {
    false
}

/// 显示/隐藏 tray popup 窗口
fn toggle_popup(app: &AppHandle, position: tauri::PhysicalPosition<f64>) {
    let label = "tray-popup";

    // 如果已存在，切换显示/隐藏
    if let Some(win) = app.get_webview_window(label) {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
            return;
        }
        // 重新定位并显示
        let _ = position_popup(&win, position);
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }

    // 首次创建
    let popup_width = 380.0;
    let popup_height = 410.0;

    let url = tauri::WebviewUrl::App("index.html".into());

    match WebviewWindowBuilder::new(app, label, url)
        .title("Codex Switcher")
        .inner_size(popup_width, popup_height)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()
    {
        Ok(win) => {
            // 监听焦点丢失 → 自动隐藏
            let win_clone = win.clone();
            win.on_window_event(move |event| {
                if let tauri::WindowEvent::Focused(false) = event {
                    let _ = win_clone.hide();
                }
            });

            let _ = position_popup(&win, position);
            let _ = win.show();
            let _ = win.set_focus();
        }
        Err(e) => eprintln!("[Tray] Failed to create popup window: {}", e),
    }
}

/// 将 popup 窗口定位到托盘图标附近（macOS 顶部菜单栏下方）
fn position_popup(
    win: &tauri::WebviewWindow,
    tray_pos: tauri::PhysicalPosition<f64>,
) -> Result<(), String> {
    let popup_width = 380.0;

    let scale = win.scale_factor().unwrap_or(1.0);

    let x = (tray_pos.x - popup_width * scale / 2.0).max(0.0) as i32;
    let y = (tray_pos.y + 4.0) as i32; // 留一点间距给菜单栏

    let _ = win.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
        x, y,
    )));
    Ok(())
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        #[cfg(target_os = "macos")]
        app.set_activation_policy(tauri::ActivationPolicy::Regular)
            .unwrap_or(());
    }
}

/// 供 Tauri command 调用的入口
pub fn show_main_window_from_cmd(app: &AppHandle) {
    show_main_window(app);
    // 同时隐藏 popup
    if let Some(popup) = app.get_webview_window("tray-popup") {
        let _ = popup.hide();
    }
}

/// 更新托盘 tooltip（不再需要完整菜单）
///
/// **关键**：`tray.set_tooltip` 是 Tauri/Cocoa GUI API，内部走 mpmc channel
/// 等主线程在 NSApplication runloop 处理。如果调用时**还持有 store.lock()**，
/// 而主线程刚好在执行 UI 的 `get_accounts`（也要拿同一把 store lock），就死锁：
///   - tokio worker: 持 store.lock() → 调 set_tooltip → 等主线程
///   - 主线程: 在 get_accounts → 等 store.lock()
/// 修法：tooltip 构建放在内层 block 让 guard 在 set_tooltip 前 drop。
pub fn update_tray_menu(app: &AppHandle) {
    let state = app.state::<crate::AppState>();
    let (tooltip, quota_summary) = {
        let store = match state.store.lock() {
            Ok(s) => s,
            Err(_) => return,
        };
        if let Some(current_id) = &store.current {
            if let Some(acc) = store.accounts.get(current_id) {
                let name = compact_account_name(&acc.name);
                match &acc.cached_quota {
                    Some(q) => (
                        format!(
                            "Codex Switcher · Selected {name} · 5H {:.0}% · 7D {:.0}% (unverified)",
                            q.five_hour_left, q.weekly_left
                        ),
                        format!(
                            "Selected {name} · 5H {:.0}% · 7D {:.0}%",
                            q.five_hour_left, q.weekly_left
                        ),
                    ),
                    None => (
                        format!("Codex Switcher · Selected {name} · quota unavailable"),
                        format!("Selected {name} · quota unavailable"),
                    ),
                }
            } else {
                (
                    "Codex Switcher".to_string(),
                    "Quota unavailable".to_string(),
                )
            }
        } else {
            (
                "Codex Switcher - Not signed in".to_string(),
                "No selected account".to_string(),
            )
        }
        // store guard 在 block 结束（这一行）时 drop，set_tooltip 在外面跑
    };

    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(&tooltip));
    }
    if let Some(item) = TRAY_QUOTA_SUMMARY.get() {
        let _ = item.set_text(quota_summary);
    }
}

fn compact_account_name(name: &str) -> String {
    let local = name.split('@').next().unwrap_or(name);
    let chars: Vec<char> = local.chars().collect();
    if chars.len() > 9 {
        format!(
            "{}…{}",
            chars[..6].iter().collect::<String>(),
            chars[chars.len() - 2..].iter().collect::<String>()
        )
    } else {
        local.to_string()
    }
}
