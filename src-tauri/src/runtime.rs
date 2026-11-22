use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(45);
const STARTUP_RETRY: Duration = Duration::from_millis(150);

#[derive(Clone, Deserialize)]
struct Endpoint {
    port: u16,
    token: String,
    pid: u32,
}

impl Endpoint {
    fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{}", self.port, path)
    }
}

#[derive(Deserialize)]
struct Health {
    pid: u32,
}

#[derive(Serialize)]
pub struct DesktopResponse {
    status: u16,
    body: Value,
}

pub struct DesktopRuntime {
    client: Client,
    directory: PathBuf,
    endpoint: Mutex<Option<Endpoint>>,
    quitting: AtomicBool,
}

impl DesktopRuntime {
    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let directory = env::var_os("SILVER_DATA_DIR")
            .map(PathBuf::from)
            .or_else(|| env::var_os("APPDATA").map(|path| PathBuf::from(path).join("Silver")))
            .ok_or("DESKTOP_DATA_DIR_UNAVAILABLE")?;
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .connect_timeout(Duration::from_secs(2))
            .read_timeout(Duration::from_secs(60))
            .build()?;
        Ok(Self {
            client,
            directory,
            endpoint: Mutex::new(None),
            quitting: AtomicBool::new(false),
        })
    }

    pub fn is_quitting(&self) -> bool {
        self.quitting.load(Ordering::Acquire)
    }

    async fn read_endpoint(&self) -> Option<Endpoint> {
        let path = self.directory.join("endpoint.json");
        let bytes = tokio::fs::read(path).await.ok()?;
        let endpoint: Endpoint = serde_json::from_slice(&bytes).ok()?;
        (endpoint.port != 0 && endpoint.pid != 0 && !endpoint.token.is_empty()).then_some(endpoint)
    }

    async fn ready(&self, endpoint: &Endpoint) -> bool {
        let result = self
            .client
            .get(endpoint.url("/health"))
            .bearer_auth(&endpoint.token)
            .timeout(Duration::from_millis(500))
            .send()
            .await;
        if let Ok(response) = result {
            if response.status().is_success() {
                return response
                    .json::<Health>()
                    .await
                    .is_ok_and(|health| health.pid == endpoint.pid);
            }
        }
        false
    }

    fn endpoint_is_current(&self, app: &AppHandle) -> bool {
        let Ok((_, entry, _)) = runtime_paths(app) else {
            return true;
        };
        let Ok(descriptor) = fs::metadata(self.directory.join("endpoint.json"))
            .and_then(|metadata| metadata.modified())
        else {
            return true;
        };
        let Ok(runtime) = fs::metadata(&entry).and_then(|metadata| metadata.modified()) else {
            return true;
        };
        descriptor >= runtime
    }

    async fn stop_stale(&self, endpoint: &Endpoint) {
        let _ = self
            .client
            .post(endpoint.url("/shutdown"))
            .bearer_auth(&endpoint.token)
            .timeout(Duration::from_secs(2))
            .send()
            .await;
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if !self.ready(endpoint).await {
                return;
            }
            tokio::time::sleep(STARTUP_RETRY).await;
        }
    }

    async fn ensure_endpoint(&self, app: &AppHandle) -> Result<Endpoint, String> {
        if self.is_quitting() {
            return Err("DESKTOP_EXITING".into());
        }
        let mut cached = self.endpoint.lock().await;
        if let Some(endpoint) = cached.as_ref() {
            return Ok(endpoint.clone());
        }
        if let Some(endpoint) = self.read_endpoint().await {
            if self.ready(&endpoint).await {
                if self.endpoint_is_current(app) {
                    *cached = Some(endpoint.clone());
                    return Ok(endpoint);
                }
                // The descriptor predates the runtime on disk, so the surviving
                // host came from an older build and cannot serve this UI.
                self.stop_stale(&endpoint).await;
            }
        }
        if self.is_quitting() {
            return Err("DESKTOP_EXITING".into());
        }
        tokio::fs::create_dir_all(&self.directory)
            .await
            .map_err(|_| "DESKTOP_DATA_DIR_CREATE_FAILED".to_owned())?;
        let mut child = spawn_runtime(app, &self.directory)?;
        let deadline = Instant::now() + STARTUP_TIMEOUT;
        let mut exit_message = None;
        while Instant::now() < deadline && !self.is_quitting() {
            if let Some(endpoint) = self.read_endpoint().await {
                if self.ready(&endpoint).await {
                    *cached = Some(endpoint.clone());
                    return Ok(endpoint);
                }
            }
            if exit_message.is_none() {
                if let Ok(Some(_status)) = child.try_wait() {
                    // Another shell can start the service while this process is losing its lock.
                    exit_message = Some("DESKTOP_RUNTIME_START_FAILED".to_owned());
                }
            }
            tokio::time::sleep(STARTUP_RETRY).await;
        }
        Err(exit_message.unwrap_or_else(|| "DESKTOP_RUNTIME_START_TIMEOUT".into()))
    }

    async fn forget_endpoint(&self, endpoint: &Endpoint) {
        let mut cached = self.endpoint.lock().await;
        if cached
            .as_ref()
            .is_some_and(|prior| prior.token == endpoint.token)
        {
            *cached = None;
        }
    }

    pub async fn watch(&self, app: &AppHandle) {
        let mut previous_error = None;
        while !self.is_quitting() {
            match self.ensure_endpoint(app).await {
                Ok(endpoint) => {
                    previous_error = None;
                    if let Ok(response) = self
                        .client
                        .get(endpoint.url("/events"))
                        .bearer_auth(&endpoint.token)
                        .send()
                        .await
                    {
                        if response.status().is_success() {
                            receive_events(response, app).await;
                        }
                    }
                    self.forget_endpoint(&endpoint).await;
                }
                Err(error) => {
                    if previous_error.as_deref() != Some(error.as_str()) {
                        let _ = tokio::fs::write(self.directory.join("startup-error.log"), &error)
                            .await;
                        previous_error = Some(error);
                    }
                }
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }

    pub async fn shutdown(&self) -> Result<(), String> {
        if self.quitting.swap(true, Ordering::AcqRel) {
            return Err("DESKTOP_EXITING".into());
        }
        let endpoint = {
            let cached = self.endpoint.lock().await;
            self.read_endpoint().await.or_else(|| cached.clone())
        };
        let Some(endpoint) = endpoint else {
            return Ok(());
        };
        let request = self
            .client
            .post(endpoint.url("/shutdown"))
            .bearer_auth(&endpoint.token)
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await;
        if request.is_ok_and(|response| response.status().is_success()) {
            let deadline = Instant::now() + REQUEST_TIMEOUT;
            while self
                .read_endpoint()
                .await
                .is_some_and(|current| current.pid == endpoint.pid)
            {
                if Instant::now() >= deadline {
                    self.quitting.store(false, Ordering::Release);
                    return Err("DESKTOP_SHUTDOWN_BUSY".into());
                }
                tokio::time::sleep(STARTUP_RETRY).await;
            }
            return Ok(());
        }
        if self.read_endpoint().await.is_none() {
            return Ok(());
        }
        self.quitting.store(false, Ordering::Release);
        Err("DESKTOP_SHUTDOWN_UNCONFIRMED".into())
    }
}

fn runtime_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf, Option<PathBuf>), String> {
    let resources = app
        .path()
        .resolve("desktop-runtime", BaseDirectory::Resource)
        .map_err(|_| "DESKTOP_RUNTIME_LOCATE_FAILED".to_owned())?;
    if cfg!(debug_assertions) {
        let project = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let path = env::var_os("SILVER_NODE").map(PathBuf::from);
        let npm = path
            .as_deref()
            .and_then(Path::parent)
            .map(|path| path.join("node_modules/npm/bin/npm-cli.js"));
        return Ok((
            path.unwrap_or_else(|| PathBuf::from("node.exe")),
            project.join("dist-cli/silver.mjs"),
            npm,
        ));
    }
    let resources = if resources.join("silver.mjs").is_file() {
        resources
    } else {
        env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|folder| folder.join("desktop-runtime")))
            .filter(|folder| folder.join("silver.mjs").is_file())
            .unwrap_or(resources)
    };
    Ok((
        resources.join("node.exe"),
        resources.join("silver.mjs"),
        Some(resources.join("node_modules/npm/bin/npm-cli.js")),
    ))
}

// Node's fetch ignores HTTP(S)_PROXY unless the process starts with
// NODE_USE_ENV_PROXY, but users behind a proxy expect provider requests to take
// the same route as their browser. Loopback stays bypassed so the CLI sidecar
// keeps talking to its host over 127.0.0.1 instead of through the proxy.
fn apply_proxy_environment(command: &mut Command) {
    if env::var_os("NODE_USE_ENV_PROXY").is_none() {
        command.env("NODE_USE_ENV_PROXY", "1");
    }
    let configured = env::var("NO_PROXY")
        .or_else(|_| env::var("no_proxy"))
        .unwrap_or_default();
    command
        .env_remove("no_proxy")
        .env("NO_PROXY", merged_no_proxy(&configured));
}

fn merged_no_proxy(configured: &str) -> String {
    let mut entries: Vec<String> = configured
        .split(',')
        .map(|entry| entry.trim().to_owned())
        .filter(|entry| !entry.is_empty())
        .collect();
    for loopback in ["localhost", "127.0.0.1", "::1"] {
        if !entries
            .iter()
            .any(|entry| entry.eq_ignore_ascii_case(loopback))
        {
            entries.push(loopback.to_owned());
        }
    }
    entries.join(",")
}

fn spawn_runtime(app: &AppHandle, directory: &Path) -> Result<std::process::Child, String> {
    let (node, entry, npm) = runtime_paths(app)?;
    if !entry.is_file() {
        return Err("DESKTOP_RUNTIME_ENTRY_MISSING".into());
    }
    let log = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(directory.join("runtime-error.log"))
        .map_err(|_| "DESKTOP_RUNTIME_LOG_OPEN_FAILED".to_owned())?;
    // Tauri resource paths may use the Windows verbatim namespace. Node's CLI
    // entrypoint resolution expects a normal DOS path when one is available.
    let node = dunce::simplified(&node);
    let entry = dunce::simplified(&entry);
    let mut command = Command::new(node);
    command
        .arg(entry)
        .arg("serve")
        .env("SILVER_DATA_DIR", directory)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::from(log));
    apply_proxy_environment(&mut command);
    if let Some(npm) = npm {
        command.env("SILVER_NPM_CLI", dunce::simplified(&npm));
    }
    if !cfg!(debug_assertions) {
        let paths = env::var_os("PATH").unwrap_or_default();
        let path_entries = node
            .parent()
            .map(Path::to_path_buf)
            .into_iter()
            .chain(env::split_paths(&paths));
        if let Ok(path) = env::join_paths(path_entries) {
            command.env("PATH", path);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
        command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }
    command
        .spawn()
        .map_err(|_| "DESKTOP_RUNTIME_SPAWN_FAILED".to_owned())
}

async fn receive_events(mut response: reqwest::Response, app: &AppHandle) {
    let mut pending = Vec::new();
    let mut data = Vec::new();
    while let Ok(Some(chunk)) = response.chunk().await {
        pending.extend_from_slice(&chunk);
        let mut read = 0;
        for end in pending
            .iter()
            .enumerate()
            .filter_map(|(i, &byte)| (byte == b'\n').then_some(i))
        {
            let mut line = &pending[read..end];
            read = end + 1;
            line = line.strip_suffix(b"\r").unwrap_or(line);
            if line.is_empty() {
                if !data.is_empty() {
                    if let Ok(value) = serde_json::from_slice::<Value>(&data) {
                        let _ = app.emit("silver://state", value);
                    }
                    data.clear();
                }
            } else if let Some(payload) = line.strip_prefix(b"data:") {
                if !data.is_empty() {
                    data.push(b'\n');
                }
                data.extend_from_slice(payload.strip_prefix(b" ").unwrap_or(payload));
            }
        }
        pending.drain(..read);
    }
}

#[tauri::command]
pub async fn desktop_request(
    app: AppHandle,
    runtime: State<'_, DesktopRuntime>,
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<DesktopResponse, String> {
    let method = match (method.as_str(), path.as_str()) {
        ("GET", "/state") => reqwest::Method::GET,
        ("POST", "/action") => reqwest::Method::POST,
        _ => return Err("DESKTOP_REQUEST_UNSUPPORTED".into()),
    };
    let endpoint = runtime.ensure_endpoint(&app).await?;
    let mut request = runtime
        .client
        .request(method, endpoint.url(&path))
        .bearer_auth(&endpoint.token)
        .timeout(REQUEST_TIMEOUT);
    if let Some(body) = body {
        request = request.json(&body);
    }
    match request.send().await {
        Ok(response) => {
            let status = response.status();
            if status == reqwest::StatusCode::UNAUTHORIZED {
                runtime.forget_endpoint(&endpoint).await;
            }
            let body = response
                .json::<Value>()
                .await
                .map_err(|_| "DESKTOP_RESPONSE_INVALID".to_owned())?;
            Ok(DesktopResponse {
                status: status.as_u16(),
                body,
            })
        }
        Err(err) => {
            runtime.forget_endpoint(&endpoint).await;
            if err.is_timeout() {
                Err("API_TIMEOUT".into())
            } else {
                Err("DESKTOP_CONNECTION_LOST".into())
            }
        }
    }
}
