use serde::Serialize;

#[derive(Debug, Serialize)]
struct ClientInfo {
    product: &'static str,
    client: &'static str,
    protocol_version: &'static str,
    platform: &'static str,
    architecture: &'static str,
}

#[tauri::command]
fn client_info() -> ClientInfo {
    ClientInfo {
        product: "Lingora",
        client: "tauri",
        protocol_version: "1",
        platform: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![client_info])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
