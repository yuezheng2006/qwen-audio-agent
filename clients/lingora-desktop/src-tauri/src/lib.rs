use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

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

#[derive(Debug, Serialize)]
struct GatewayCommandResult {
    ok: bool,
    action: String,
    output: String,
    error: Option<String>,
}

fn runtime_root(app: Option<&tauri::AppHandle>) -> PathBuf {
    if let Some(root) = std::env::var_os("LINGORA_RUNTIME_ROOT").map(PathBuf::from) {
        return root;
    }

    if let Some(resource_root) = app
        .and_then(|handle| handle.path().resource_dir().ok())
        .map(|root| root.join("runtime"))
    {
        if resource_root.join("scripts/start-gateway.mjs").is_file() {
            return resource_root;
        }
    }

    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn node_binary() -> String {
    std::env::var("LINGORA_NODE_BINARY").unwrap_or_else(|_| "node".to_string())
}

fn gateway_action_args(action: &str) -> Option<Vec<&'static str>> {
    match action {
        "start" => Some(vec!["scripts/start-gateway.mjs", "cascade"]),
        "stop" => Some(vec!["scripts/start-gateway.mjs", "stop"]),
        _ => None,
    }
}

fn run_gateway_action(action: &str, root: &Path) -> GatewayCommandResult {
    let Some(args) = gateway_action_args(action) else {
        return GatewayCommandResult {
            ok: false,
            action: action.to_string(),
            output: String::new(),
            error: Some("unsupported gateway action".to_string()),
        };
    };
    let script = root.join(args[0]);
    if !script.is_file() {
        return GatewayCommandResult {
            ok: false,
            action: action.to_string(),
            output: String::new(),
            error: Some(format!("gateway runtime not found: {}", script.display())),
        };
    }

    match Command::new(node_binary())
        .current_dir(root)
        .args(args)
        .output()
    {
        Ok(result) => {
            let stdout = String::from_utf8_lossy(&result.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&result.stderr).trim().to_string();
            GatewayCommandResult {
                ok: result.status.success(),
                action: action.to_string(),
                output: if stdout.is_empty() {
                    stderr.clone()
                } else {
                    stdout
                },
                error: if result.status.success() || stderr.is_empty() {
                    None
                } else {
                    Some(stderr)
                },
            }
        }
        Err(error) => GatewayCommandResult {
            ok: false,
            action: action.to_string(),
            output: String::new(),
            error: Some(error.to_string()),
        },
    }
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

#[tauri::command]
async fn gateway_start(app: tauri::AppHandle) -> GatewayCommandResult {
    tauri::async_runtime::spawn_blocking(move || {
        let root = runtime_root(Some(&app));
        run_gateway_action("start", &root)
    })
    .await
    .unwrap_or_else(|error| GatewayCommandResult {
        ok: false,
        action: "start".to_string(),
        output: String::new(),
        error: Some(error.to_string()),
    })
}

#[tauri::command]
async fn gateway_stop(app: tauri::AppHandle) -> GatewayCommandResult {
    tauri::async_runtime::spawn_blocking(move || {
        let root = runtime_root(Some(&app));
        run_gateway_action("stop", &root)
    })
    .await
    .unwrap_or_else(|error| GatewayCommandResult {
        ok: false,
        action: "stop".to_string(),
        output: String::new(),
        error: Some(error.to_string()),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            client_info,
            gateway_health,
            gateway_start,
            gateway_stop
        ])
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

#[cfg(test)]
mod tests {
    use super::gateway_action_args;

    #[test]
    fn gateway_actions_are_fixed_to_the_local_runtime_contract() {
        assert_eq!(
            gateway_action_args("start"),
            Some(vec!["scripts/start-gateway.mjs", "cascade"])
        );
        assert_eq!(
            gateway_action_args("stop"),
            Some(vec!["scripts/start-gateway.mjs", "stop"])
        );
        assert_eq!(gateway_action_args("restart"), None);
    }
}
