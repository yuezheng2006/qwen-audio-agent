use serde::Serialize;

#[derive(Debug, Serialize)]
struct ClientInfo {
    product: &'static str,
    client: &'static str,
    protocol_version: &'static str,
    platform: &'static str,
    architecture: &'static str,
}

#[derive(Debug, Serialize)]
struct GatewayHealth {
    reachable: bool,
    url: String,
    status_code: Option<u16>,
    payload: Option<serde_json::Value>,
    error: Option<String>,
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

#[tauri::command]
async fn gateway_health(base_url: Option<String>) -> GatewayHealth {
    let base_url = base_url
        .unwrap_or_else(|| "http://127.0.0.1:3101".to_string())
        .trim_end_matches('/')
        .to_string();
    let url = format!("{base_url}/api/health");
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(1500))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return GatewayHealth {
                reachable: false,
                url,
                status_code: None,
                payload: None,
                error: Some(error.to_string()),
            }
        }
    };

    match client.get(&url).send().await {
        Ok(response) => {
            let status_code = response.status().as_u16();
            let payload = response.json::<serde_json::Value>().await.ok();
            GatewayHealth {
                reachable: status_code < 500 && payload.is_some(),
                url,
                status_code: Some(status_code),
                payload,
                error: None,
            }
        }
        Err(error) => GatewayHealth {
            reachable: false,
            url,
            status_code: None,
            payload: None,
            error: Some(error.to_string()),
        },
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![client_info, gateway_health])
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
