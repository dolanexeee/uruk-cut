use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

/// Result of one ffmpeg sidecar run: process exit code plus its combined
/// stdout/stderr (capped — the webview only needs the tail of it, e.g. the
/// `ffmpeg -i` banner used for audio-stream detection).
#[derive(Serialize)]
struct FFmpegRunResult {
    code: i32,
    output: String,
}

#[derive(Clone, Serialize)]
struct FFmpegProgress {
    /// Seconds of media processed so far, parsed from ffmpeg's `time=` stamps.
    time: f64,
}

/// Parse the LAST `time=HH:MM:SS.xx` stamp in `text` into seconds.
fn parse_time_secs(text: &str) -> Option<f64> {
    let idx = text.rfind("time=")?;
    let rest = &text[idx + 5..];
    let token: String = rest
        .chars()
        .take_while(|c| *c != ' ' && *c != '\r' && *c != '\n')
        .collect();
    let parts: Vec<&str> = token.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let h: f64 = parts[0].parse().ok()?;
    let m: f64 = parts[1].parse().ok()?;
    let s: f64 = parts[2].parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

/// Run the bundled ffmpeg sidecar with a caller-supplied argument array.
/// Streams `ffmpeg-progress` events to the webview while it runs and
/// resolves with the exit code and captured output. Never rejects for a
/// non-zero ffmpeg exit — that is reported via `code`, so probe-style
/// invocations (`ffmpeg -i file`, which exits 1) work as expected.
#[tauri::command]
async fn run_ffmpeg(app: AppHandle, args: Vec<String>) -> Result<FFmpegRunResult, String> {
    let sidecar = app
        .shell()
        .sidecar("uruk-ffmpeg")
        .map_err(|e| format!("ffmpeg sidecar unavailable: {e}"))?;
    let (mut rx, _child) = sidecar
        .args(args)
        .spawn()
        .map_err(|e| format!("failed to start ffmpeg: {e}"))?;

    let mut output = String::new();
    let mut carry = String::new();
    let mut last_emitted: f64 = -1.0;
    let mut code: i32 = -1;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                let text = String::from_utf8_lossy(&bytes).into_owned();
                // Keep at most ~1 MB of output: enough for banners/probes,
                // bounded for long encodes.
                if output.len() < 1_000_000 {
                    output.push_str(&text);
                }
                // `time=` stamps can straddle chunk boundaries: search the
                // concatenation of a short carry-over with the new chunk.
                let combined = format!("{carry}{text}");
                if let Some(secs) = parse_time_secs(&combined) {
                    if (secs - last_emitted).abs() > 0.05 {
                        last_emitted = secs;
                        let _ = app.emit("ffmpeg-progress", FFmpegProgress { time: secs });
                    }
                }
                carry = combined
                    .chars()
                    .rev()
                    .take(32)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect();
            }
            CommandEvent::Error(err) => {
                return Err(format!("ffmpeg process error: {err}"));
            }
            CommandEvent::Terminated(payload) => {
                code = payload.code.unwrap_or(-1);
            }
            _ => {}
        }
    }

    Ok(FFmpegRunResult { code, output })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![run_ffmpeg])
        .run(tauri::generate_context!())
        .expect("error while running Uruk Cut");
}
