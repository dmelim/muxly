//! Repeatedly starts and stops a Windows development command through
//! `portable-pty`, recording enough timing and process information to compare
//! launch strategies.
//!
//! Example:
//! cargo run --example pty_restart_probe -- \
//!   --cwd C:\Trabalho\diethos\focus-homestead \
//!   --port 1421 \
//!   --cycles 10

#[cfg(not(windows))]
fn main() {
    eprintln!("pty_restart_probe only supports Windows");
    std::process::exit(2);
}

#[cfg(windows)]
mod windows_probe {
    use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
    use std::{
        collections::BTreeMap,
        env,
        fs::{self, File},
        io::{Read, Write},
        net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream},
        path::{Path, PathBuf},
        process::{Command, Stdio},
        sync::{
            atomic::{AtomicBool, AtomicU64, Ordering},
            mpsc, Arc, Mutex,
        },
        thread,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };

    const DEFAULT_COLS: u16 = 120;
    const DEFAULT_ROWS: u16 = 30;

    #[derive(Clone, Copy, Debug)]
    enum LaunchKind {
        DirectNpmResize,
        DirectNpmResizeNoCursorReply,
        DirectNpmNoResize,
        CmdNpmResize,
        NodeNpmCliResize,
        NodeScriptResize,
    }

    impl LaunchKind {
        fn name(self) -> &'static str {
            match self {
                Self::DirectNpmResize => "pty-direct-npm-resize",
                Self::DirectNpmResizeNoCursorReply => "pty-direct-npm-resize-no-cursor-reply",
                Self::DirectNpmNoResize => "pty-direct-npm-no-resize",
                Self::CmdNpmResize => "pty-cmd-npm-resize",
                Self::NodeNpmCliResize => "pty-node-npm-cli-resize",
                Self::NodeScriptResize => "pty-node-script-resize",
            }
        }

        fn resize_immediately(self) -> bool {
            !matches!(self, Self::DirectNpmNoResize)
        }

        fn reply_to_cursor_query(self) -> bool {
            !matches!(self, Self::DirectNpmResizeNoCursorReply)
        }
    }

    #[derive(Debug)]
    struct Options {
        cwd: PathBuf,
        port: u16,
        cycles: u32,
        timeout: Duration,
        cooldown: Duration,
        output_dir: PathBuf,
        npm_cmd: PathBuf,
        node_exe: PathBuf,
        npm_cli: PathBuf,
        cases: Vec<LaunchKind>,
    }

    #[derive(Debug)]
    struct ProbeResult {
        case_name: &'static str,
        cycle: u32,
        pid: u32,
        spawn_ms: u128,
        resize_ms: Option<u128>,
        first_output_ms: Option<u128>,
        ready_ms: Option<u128>,
        bytes: u64,
        cursor_queries: u64,
        spawn_error: Option<String>,
        resize_error: Option<String>,
        cleanup_error: Option<String>,
        preview: String,
    }

    impl ProbeResult {
        fn succeeded(&self) -> bool {
            self.spawn_error.is_none() && self.ready_ms.is_some()
        }
    }

    pub fn run() -> Result<(), String> {
        let options = parse_options()?;
        validate_options(&options)?;

        if port_is_listening(options.port) {
            return Err(format!(
                "port {} is already listening; stop its owner before running the probe",
                options.port
            ));
        }

        fs::create_dir_all(&options.output_dir)
            .map_err(|error| format!("create {}: {error}", options.output_dir.display()))?;
        let summary_path = options.output_dir.join("summary.csv");
        let mut summary = File::create(&summary_path)
            .map_err(|error| format!("create {}: {error}", summary_path.display()))?;
        writeln!(
            summary,
            "case,cycle,success,pid,spawn_ms,resize_ms,first_output_ms,ready_ms,bytes,cursor_queries,spawn_error,resize_error,cleanup_error,preview"
        )
        .map_err(|error| format!("write summary header: {error}"))?;

        println!("PTY restart probe");
        println!("cwd: {}", options.cwd.display());
        println!("readiness port: {}", options.port);
        println!("cycles per case: {}", options.cycles);
        println!("timeout: {} ms", options.timeout.as_millis());
        println!("output: {}", options.output_dir.display());

        let mut totals: BTreeMap<&'static str, (u32, u32)> = BTreeMap::new();
        for kind in &options.cases {
            println!("\n== {} ==", kind.name());
            for cycle in 1..=options.cycles {
                let result = run_cycle(&options, *kind, cycle);
                let entry = totals.entry(kind.name()).or_default();
                entry.1 += 1;
                if result.succeeded() {
                    entry.0 += 1;
                }

                print_result(&result);
                write_result(&mut summary, &result)?;
                summary
                    .flush()
                    .map_err(|error| format!("flush summary: {error}"))?;

                wait_until_port_free(options.port, Duration::from_secs(8));
                thread::sleep(options.cooldown);
            }
        }

        println!("\n== totals ==");
        for (case_name, (passed, attempted)) in totals {
            println!(
                "{case_name}: {passed}/{attempted} reached port {}",
                options.port
            );
        }
        println!("summary: {}", summary_path.display());
        Ok(())
    }

    fn run_cycle(options: &Options, kind: LaunchKind, cycle: u32) -> ProbeResult {
        let started_at = Instant::now();
        let pty_system = native_pty_system();
        let pair = match pty_system.openpty(PtySize {
            rows: DEFAULT_ROWS,
            cols: DEFAULT_COLS,
            pixel_width: 0,
            pixel_height: 0,
        }) {
            Ok(pair) => pair,
            Err(error) => {
                return failed_before_spawn(kind, cycle, started_at, format!("openpty: {error}"));
            }
        };

        let mut command = build_command(options, kind);
        command.cwd(&options.cwd);
        // Keep the test isolated from a developer's already-running instance.
        // Focus Homestead's launcher and Vite both honor this variable.
        command.env("FH_DEV_PORT", options.port.to_string());
        command.env("NO_COLOR", "1");
        command.env("CI", "0");

        let spawn_started = Instant::now();
        let child = match pair.slave.spawn_command(command) {
            Ok(child) => child,
            Err(error) => {
                return failed_before_spawn(kind, cycle, started_at, format!("spawn: {error}"));
            }
        };
        let spawn_ms = spawn_started.elapsed().as_millis();
        let pid = child.process_id().unwrap_or(0);
        drop(pair.slave);

        let reader = match pair.master.try_clone_reader() {
            Ok(reader) => reader,
            Err(error) => {
                let cleanup_error = terminate_tree(pid).err();
                return ProbeResult {
                    case_name: kind.name(),
                    cycle,
                    pid,
                    spawn_ms,
                    resize_ms: None,
                    first_output_ms: None,
                    ready_ms: None,
                    bytes: 0,
                    cursor_queries: 0,
                    spawn_error: Some(format!("clone reader: {error}")),
                    resize_error: None,
                    cleanup_error,
                    preview: String::new(),
                };
            }
        };
        let writer = match pair.master.take_writer() {
            Ok(writer) => Arc::new(Mutex::new(writer)),
            Err(error) => {
                let cleanup_error = terminate_tree(pid).err();
                return ProbeResult {
                    case_name: kind.name(),
                    cycle,
                    pid,
                    spawn_ms,
                    resize_ms: None,
                    first_output_ms: None,
                    ready_ms: None,
                    bytes: 0,
                    cursor_queries: 0,
                    spawn_error: Some(format!("take writer: {error}")),
                    resize_error: None,
                    cleanup_error,
                    preview: String::new(),
                };
            }
        };

        let bytes_seen = Arc::new(AtomicU64::new(0));
        let cursor_queries = Arc::new(AtomicU64::new(0));
        let reader_done = Arc::new(AtomicBool::new(false));
        let (output_tx, output_rx) = mpsc::channel::<Vec<u8>>();
        spawn_reader(
            reader,
            writer,
            output_tx,
            bytes_seen.clone(),
            cursor_queries.clone(),
            reader_done.clone(),
            kind.reply_to_cursor_query(),
        );

        let (master, resize_ms, resize_error) = if kind.resize_immediately() {
            resize_once(pair.master, Duration::from_secs(4))
        } else {
            (Some(pair.master), None, None)
        };

        let mut first_output_ms = None;
        let mut ready_ms = None;
        let mut preview = Vec::new();
        while started_at.elapsed() < options.timeout {
            while let Ok(chunk) = output_rx.try_recv() {
                if first_output_ms.is_none() && contains_real_line(&chunk) {
                    first_output_ms = Some(started_at.elapsed().as_millis());
                }
                if preview.len() < 4096 {
                    let remaining = 4096 - preview.len();
                    preview.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
                }
            }

            if port_is_listening(options.port) {
                ready_ms = Some(started_at.elapsed().as_millis());
                break;
            }
            if reader_done.load(Ordering::Relaxed) {
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }

        let cleanup_error = terminate_tree(pid).err();
        drop(child);
        if let Some(master) = master {
            // `ClosePseudoConsole` was blocking on Windows versions before
            // 11 24H2 when teardown pipes were not drained perfectly. Keep a
            // teardown defect from preventing the remaining matrix cases.
            thread::spawn(move || drop(master));
        }

        while let Ok(chunk) = output_rx.try_recv() {
            if preview.len() >= 4096 {
                break;
            }
            let remaining = 4096 - preview.len();
            preview.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
        }

        ProbeResult {
            case_name: kind.name(),
            cycle,
            pid,
            spawn_ms,
            resize_ms,
            first_output_ms,
            ready_ms,
            bytes: bytes_seen.load(Ordering::Relaxed),
            cursor_queries: cursor_queries.load(Ordering::Relaxed),
            spawn_error: None,
            resize_error,
            cleanup_error,
            preview: sanitize_preview(&preview),
        }
    }

    fn build_command(options: &Options, kind: LaunchKind) -> CommandBuilder {
        match kind {
            LaunchKind::DirectNpmResize
            | LaunchKind::DirectNpmResizeNoCursorReply
            | LaunchKind::DirectNpmNoResize => {
                let mut command = CommandBuilder::new(options.npm_cmd.as_os_str());
                command.arg("run");
                command.arg("tauri:dev");
                command
            }
            LaunchKind::CmdNpmResize => {
                let mut command = CommandBuilder::new("cmd.exe");
                command.arg("/D");
                command.arg("/C");
                command.arg(options.npm_cmd.as_os_str());
                command.arg("run");
                command.arg("tauri:dev");
                command
            }
            LaunchKind::NodeNpmCliResize => {
                let mut command = CommandBuilder::new(options.node_exe.as_os_str());
                command.arg(options.npm_cli.as_os_str());
                command.arg("run");
                command.arg("tauri:dev");
                command
            }
            LaunchKind::NodeScriptResize => {
                let mut command = CommandBuilder::new(options.node_exe.as_os_str());
                command.arg(options.cwd.join("scripts").join("dev.mjs").as_os_str());
                command
            }
        }
    }

    fn spawn_reader(
        mut reader: Box<dyn Read + Send>,
        writer: Arc<Mutex<Box<dyn Write + Send>>>,
        output_tx: mpsc::Sender<Vec<u8>>,
        bytes_seen: Arc<AtomicU64>,
        cursor_queries: Arc<AtomicU64>,
        reader_done: Arc<AtomicBool>,
        reply_to_cursor_query: bool,
    ) {
        thread::spawn(move || {
            let mut buffer = [0u8; 8192];
            let mut tail = Vec::new();
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(count) => {
                        bytes_seen.fetch_add(count as u64, Ordering::Relaxed);
                        let chunk = buffer[..count].to_vec();

                        let tail_len = tail.len();
                        let mut scan = tail.clone();
                        scan.extend_from_slice(&chunk);
                        let query_count = count_new_cursor_queries(&scan, tail_len);
                        if query_count > 0 {
                            cursor_queries.fetch_add(query_count as u64, Ordering::Relaxed);
                            if reply_to_cursor_query {
                                if let Ok(mut input) = writer.lock() {
                                    for _ in 0..query_count {
                                        let _ = input.write_all(b"\x1b[1;1R");
                                    }
                                    let _ = input.flush();
                                }
                            }
                        }
                        tail = scan[scan.len().saturating_sub(8)..].to_vec();

                        if output_tx.send(chunk).is_err() {
                            break;
                        }
                    }
                }
            }
            reader_done.store(true, Ordering::Relaxed);
        });
    }

    fn count_new_cursor_queries(bytes: &[u8], old_tail_len: usize) -> usize {
        [(b"\x1b[6n".as_slice()), (b"\x1b[?6n".as_slice())]
            .iter()
            .map(|query| {
                bytes
                    .windows(query.len())
                    .enumerate()
                    .filter(|(start, window)| {
                        *window == *query && start + query.len() > old_tail_len
                    })
                    .count()
            })
            .sum()
    }

    fn resize_once(
        master: Box<dyn MasterPty + Send>,
        timeout: Duration,
    ) -> (
        Option<Box<dyn MasterPty + Send>>,
        Option<u128>,
        Option<String>,
    ) {
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let started = Instant::now();
            let result = master
                .resize(PtySize {
                    rows: 32,
                    cols: 116,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|error| error.to_string());
            let _ = tx.send((master, started.elapsed().as_millis(), result));
        });
        match rx.recv_timeout(timeout) {
            Ok((master, elapsed, Ok(()))) => (Some(master), Some(elapsed), None),
            Ok((master, elapsed, Err(error))) => (Some(master), Some(elapsed), Some(error)),
            Err(mpsc::RecvTimeoutError::Timeout) => (
                None,
                Some(timeout.as_millis()),
                Some(format!("resize timed out after {} ms", timeout.as_millis())),
            ),
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                (None, None, Some("resize worker disconnected".to_string()))
            }
        }
    }

    fn terminate_tree(pid: u32) -> Result<(), String> {
        if pid == 0 {
            return Ok(());
        }
        let output = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F", "/T"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|error| format!("taskkill pid {pid}: {error}"))?;
        if output.status.success() {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        if detail.to_ascii_lowercase().contains("not found")
            || detail.to_ascii_lowercase().contains("not running")
        {
            return Ok(());
        }
        Err(format!(
            "taskkill pid {pid} exited {}: {detail}",
            output.status
        ))
    }

    fn port_is_listening(port: u16) -> bool {
        [
            SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port),
            SocketAddr::new(IpAddr::V6(Ipv6Addr::LOCALHOST), port),
        ]
        .iter()
        .any(|address| TcpStream::connect_timeout(address, Duration::from_millis(120)).is_ok())
    }

    fn wait_until_port_free(port: u16, timeout: Duration) {
        let started = Instant::now();
        while started.elapsed() < timeout {
            if !port_is_listening(port) {
                return;
            }
            thread::sleep(Duration::from_millis(100));
        }
    }

    fn contains_real_line(chunk: &[u8]) -> bool {
        chunk.contains(&b'\n')
    }

    fn failed_before_spawn(
        kind: LaunchKind,
        cycle: u32,
        started_at: Instant,
        error: String,
    ) -> ProbeResult {
        ProbeResult {
            case_name: kind.name(),
            cycle,
            pid: 0,
            spawn_ms: started_at.elapsed().as_millis(),
            resize_ms: None,
            first_output_ms: None,
            ready_ms: None,
            bytes: 0,
            cursor_queries: 0,
            spawn_error: Some(error),
            resize_error: None,
            cleanup_error: None,
            preview: String::new(),
        }
    }

    fn print_result(result: &ProbeResult) {
        println!(
            "[{}/{}] success={} pid={} spawn={}ms resize={} first-output={} ready={} bytes={} cursor-queries={}",
            result.case_name,
            result.cycle,
            result.succeeded(),
            result.pid,
            result.spawn_ms,
            optional_ms(result.resize_ms),
            optional_ms(result.first_output_ms),
            optional_ms(result.ready_ms),
            result.bytes,
            result.cursor_queries,
        );
        if let Some(error) = &result.spawn_error {
            println!("  spawn error: {error}");
        }
        if let Some(error) = &result.resize_error {
            println!("  resize error: {error}");
        }
        if let Some(error) = &result.cleanup_error {
            println!("  cleanup error: {error}");
        }
        if !result.preview.is_empty() {
            println!("  preview: {}", result.preview);
        }
    }

    fn write_result(summary: &mut File, result: &ProbeResult) -> Result<(), String> {
        writeln!(
            summary,
            "{},{},{},{},{},{},{},{},{},{},{},{},{},{}",
            csv(result.case_name),
            result.cycle,
            result.succeeded(),
            result.pid,
            result.spawn_ms,
            result
                .resize_ms
                .map(|value| value.to_string())
                .unwrap_or_default(),
            result
                .first_output_ms
                .map(|value| value.to_string())
                .unwrap_or_default(),
            result
                .ready_ms
                .map(|value| value.to_string())
                .unwrap_or_default(),
            result.bytes,
            result.cursor_queries,
            csv(result.spawn_error.as_deref().unwrap_or_default()),
            csv(result.resize_error.as_deref().unwrap_or_default()),
            csv(result.cleanup_error.as_deref().unwrap_or_default()),
            csv(&result.preview),
        )
        .map_err(|error| format!("write summary row: {error}"))
    }

    fn csv(value: &str) -> String {
        format!("\"{}\"", value.replace('"', "\"\""))
    }

    fn optional_ms(value: Option<u128>) -> String {
        value
            .map(|milliseconds| format!("{milliseconds}ms"))
            .unwrap_or_else(|| "-".to_string())
    }

    fn sanitize_preview(bytes: &[u8]) -> String {
        String::from_utf8_lossy(bytes)
            .replace('\0', "")
            .replace('\r', "\\r")
            .replace('\n', "\\n")
            .replace('\u{1b}', "\\x1b")
    }

    fn parse_options() -> Result<Options, String> {
        let mut values = env::args().skip(1);
        let mut cwd = None;
        let mut port = 1421u16;
        let mut cycles = 5u32;
        let mut timeout_ms = 45_000u64;
        let mut cooldown_ms = 800u64;
        let mut output_dir = None;
        let mut selected_cases: Vec<String> = Vec::new();

        while let Some(argument) = values.next() {
            match argument.as_str() {
                "--cwd" => cwd = Some(PathBuf::from(next_value(&mut values, "--cwd")?)),
                "--port" => {
                    port = next_value(&mut values, "--port")?
                        .parse()
                        .map_err(|error| format!("invalid --port: {error}"))?
                }
                "--cycles" => {
                    cycles = next_value(&mut values, "--cycles")?
                        .parse()
                        .map_err(|error| format!("invalid --cycles: {error}"))?
                }
                "--timeout-ms" => {
                    timeout_ms = next_value(&mut values, "--timeout-ms")?
                        .parse()
                        .map_err(|error| format!("invalid --timeout-ms: {error}"))?
                }
                "--cooldown-ms" => {
                    cooldown_ms = next_value(&mut values, "--cooldown-ms")?
                        .parse()
                        .map_err(|error| format!("invalid --cooldown-ms: {error}"))?
                }
                "--output" => {
                    output_dir = Some(PathBuf::from(next_value(&mut values, "--output")?))
                }
                "--case" => selected_cases.push(next_value(&mut values, "--case")?),
                "--help" | "-h" => {
                    print_help();
                    std::process::exit(0);
                }
                other => return Err(format!("unknown argument: {other}")),
            }
        }

        let cwd = cwd.ok_or_else(|| "--cwd is required".to_string())?;
        let node_exe = resolve_command("node.exe")
            .ok_or_else(|| "node.exe was not found on PATH".to_string())?;
        let npm_cmd = resolve_command("npm.cmd")
            .ok_or_else(|| "npm.cmd was not found on PATH".to_string())?;
        let npm_cli = node_exe
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("node_modules")
            .join("npm")
            .join("bin")
            .join("npm-cli.js");
        let run_id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let output_dir = output_dir.unwrap_or_else(|| {
            PathBuf::from("target")
                .join("pty-restart-probe")
                .join(run_id.to_string())
        });

        Ok(Options {
            cwd,
            port,
            cycles,
            timeout: Duration::from_millis(timeout_ms),
            cooldown: Duration::from_millis(cooldown_ms),
            output_dir,
            npm_cmd,
            node_exe,
            npm_cli,
            cases: parse_cases(&selected_cases)?,
        })
    }

    fn parse_cases(selected: &[String]) -> Result<Vec<LaunchKind>, String> {
        if selected.is_empty() {
            return Ok(vec![
                LaunchKind::DirectNpmResize,
                LaunchKind::DirectNpmNoResize,
                LaunchKind::CmdNpmResize,
                LaunchKind::NodeNpmCliResize,
                LaunchKind::NodeScriptResize,
            ]);
        }
        selected
            .iter()
            .map(|name| match name.as_str() {
                "pty-direct-npm-resize" => Ok(LaunchKind::DirectNpmResize),
                "pty-direct-npm-resize-no-cursor-reply" => {
                    Ok(LaunchKind::DirectNpmResizeNoCursorReply)
                }
                "pty-direct-npm-no-resize" => Ok(LaunchKind::DirectNpmNoResize),
                "pty-cmd-npm-resize" => Ok(LaunchKind::CmdNpmResize),
                "pty-node-npm-cli-resize" => Ok(LaunchKind::NodeNpmCliResize),
                "pty-node-script-resize" => Ok(LaunchKind::NodeScriptResize),
                other => Err(format!("unknown case: {other}")),
            })
            .collect()
    }

    fn next_value(
        values: &mut impl Iterator<Item = String>,
        option: &str,
    ) -> Result<String, String> {
        values
            .next()
            .ok_or_else(|| format!("{option} requires a value"))
    }

    fn validate_options(options: &Options) -> Result<(), String> {
        if !options.cwd.is_dir() {
            return Err(format!("cwd does not exist: {}", options.cwd.display()));
        }
        if options.cycles == 0 {
            return Err("--cycles must be greater than zero".to_string());
        }
        for path in [&options.node_exe, &options.npm_cmd, &options.npm_cli] {
            if !path.is_file() {
                return Err(format!(
                    "required launcher does not exist: {}",
                    path.display()
                ));
            }
        }
        if !options.cwd.join("scripts").join("dev.mjs").is_file() {
            return Err(format!(
                "target script does not exist: {}",
                options.cwd.join("scripts").join("dev.mjs").display()
            ));
        }
        Ok(())
    }

    fn resolve_command(name: &str) -> Option<PathBuf> {
        let output = Command::new("where.exe").arg(name).output().ok()?;
        if !output.status.success() {
            return None;
        }
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(PathBuf::from)
            .find(|path| path.is_file())
    }

    fn print_help() {
        println!(
            "Usage: pty_restart_probe --cwd PATH [--port 1421] [--cycles 5] \
             [--timeout-ms 45000] [--cooldown-ms 800] [--output PATH] \
             [--case NAME ...]"
        );
        println!("Cases:");
        println!("  pty-direct-npm-resize");
        println!("  pty-direct-npm-resize-no-cursor-reply");
        println!("  pty-direct-npm-no-resize");
        println!("  pty-cmd-npm-resize");
        println!("  pty-node-npm-cli-resize");
        println!("  pty-node-script-resize");
    }
}

#[cfg(windows)]
fn main() {
    if let Err(error) = windows_probe::run() {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}
