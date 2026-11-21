#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod runtime;

use runtime::{desktop_request, DesktopRuntime};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
async fn choose_workspace(app: AppHandle) -> Result<Option<String>, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("打开工作区文件夹")
        .pick_folder(move |folder| {
            let _ = send.send(folder);
        });
    let selection = receive
        .await
        .map_err(|_| "无法打开文件夹选择窗口。".to_owned())?;
    selection
        .map(|folder| {
            folder
                .into_path()
                .map_err(|_| "仅支持本机工作区文件夹。".to_owned())?
                .into_os_string()
                .into_string()
                .map_err(|_| "所选文件夹路径无法读取。".to_owned())
        })
        .transpose()
}

fn quit_from_tray(app: AppHandle) {
    let runtime = app.state::<DesktopRuntime>();
    if runtime.is_quitting() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        match app.state::<DesktopRuntime>().shutdown().await {
            Ok(()) => app.exit(0),
            Err(error) => app.dialog().message(error).title("Silver").show(|_| {}),
        }
    });
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_main(app)
        }))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![desktop_request, choose_workspace])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if !window.state::<DesktopRuntime>().is_quitting() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            app.manage(DesktopRuntime::new()?);
            let open = MenuItem::with_id(app, "open", "打开 Silver", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "保存并退出 Silver", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let mut tray = TrayIconBuilder::with_id("silver")
                .tooltip("Silver")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => quit_from_tray(app.clone()),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            let app = app.handle().clone();
            tauri::async_runtime::spawn(
                async move { app.state::<DesktopRuntime>().watch(&app).await },
            );
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to start the Silver desktop application");

    app.run(|_, _| {});
}
