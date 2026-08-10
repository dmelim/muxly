use crate::error::AppError;
use parking_lot::Mutex;
use portable_pty::ChildKiller;
use std::process::{Child, Command};
use std::sync::Arc;

/// How long a process tree gets to honour SIGTERM before we escalate to
/// SIGKILL. Long enough for a dev server to flush state and close sockets,
/// short enough to stay inside the 3s shutdown budget in `lib.rs`.
#[cfg(unix)]
const TERM_GRACE: std::time::Duration = std::time::Duration::from_millis(2000);

#[cfg(windows)]
use std::os::windows::io::AsRawHandle;

#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE},
    System::{
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
        Threading::{OpenProcess, CREATE_SUSPENDED, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
    },
};

// NtResumeProcess is a stable export of ntdll.dll. It atomically resumes every
// thread of a process, which is exactly what we need after spawning with
// CREATE_SUSPENDED and assigning the child to a Job Object. windows-sys 0.61
// does not yet expose it in the Wdk namespace, so we link it manually.
#[cfg(windows)]
#[link(name = "ntdll")]
extern "system" {
    fn NtResumeProcess(handle: HANDLE) -> i32;
}

/// A PTY child's killer handle, wrapped so it satisfies `Clone` (needed for
/// `running_terminators()` snapshots) and can be invoked from any thread. The
/// `Arc<Mutex<...>>` mirrors the pattern used for live shells in `pty.rs` —
/// `ChildKiller::kill` takes `&mut self`, so the mutex is required.
pub type PtyKillHandle = Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>;

#[derive(Debug, Clone)]
pub enum ProcessTerminator {
    #[cfg(windows)]
    Job(Arc<JobObject>),
    #[cfg(not(windows))]
    ProcessGroup(u32),
    /// Service spawned through `portable_pty`. See `PtyTerminator`.
    Pty(PtyTerminator),
}

/// Terminator for a PTY-backed service. `portable_pty` spawns the child for us
/// (we never see a `std::process::Child` and can't set creation flags), so the
/// `ChildKiller` is always our baseline way to stop the immediate child. On
/// Windows we *additionally* try to capture the running child in a Job Object
/// after the fact — terminating that reaps the whole tree. Without it, only the
/// immediate child dies and any grandchildren it spawned leak.
///
/// On Unix that same reach comes for free from the PTY itself: allocating a
/// slave pty makes `portable_pty` call `setsid()`, so the child is a session
/// *and* process-group leader whose pgid equals its pid. Signalling `-pid`
/// therefore reaches the whole tree — which is what `npm run dev` needs, since
/// killing only npm leaves the `node` grandchild holding the port.
#[derive(Debug, Clone)]
pub struct PtyTerminator {
    killer: PtyKillHandle,
    #[cfg(windows)]
    job: Option<Arc<JobObject>>,
    /// The PTY child's PID. On Windows the terminate path runs `taskkill /T`
    /// with it to walk the live process tree by parent→child links and catch
    /// grandchildren that escaped the Job Object assignment race. On Unix it
    /// doubles as the process-group id to signal (see the note above).
    pid: u32,
}

impl ProcessTerminator {
    pub fn terminate(&self) -> Result<(), AppError> {
        match self {
            #[cfg(windows)]
            Self::Job(job) => job.terminate(),
            #[cfg(not(windows))]
            Self::ProcessGroup(pid) => terminate_process_tree(*pid),
            Self::Pty(pty) => pty.terminate(),
        }
    }
}

impl PtyTerminator {
    #[cfg(windows)]
    fn terminate(&self) -> Result<(), AppError> {
        // First, walk and kill the whole live process tree by PID. `taskkill /T`
        // follows parent→child links (not Job Object membership), so it reaps a
        // grandchild that forked and escaped the job during the assignment race
        // — e.g. the `next`/Turbopack server that actually binds the port.
        // ConPTY spawns the child already running, so unlike the pipe path we
        // can't suspend-assign-resume to close that window; this sweep is the
        // backstop. It must run *before* we kill the root, while the parent
        // chain is intact — once the root dies its children get reparented and
        // escape the /T walk, leaking an orphan that keeps holding the port.
        // Best-effort: taskkill returns non-zero ("not found") once the tree is
        // already gone, which is expected, so we ignore its status.
        if self.pid != 0 {
            let _ = Command::new("taskkill")
                .args(["/PID", &self.pid.to_string(), "/F", "/T"])
                .status();
        }

        // Backstop: `TerminateJobObject` reaps anything the tree-walk missed
        // (and anything captured in the job), and the killer makes
        // `portable_pty`'s `wait()` return promptly. Harmless if the child is
        // already gone.
        if let Some(job) = &self.job {
            let result = job.terminate();
            let _ = self.killer.lock().kill();
            return result;
        }
        self.kill_child_only()
    }

    /// Unix: signal the child's whole process group, then escalate to SIGKILL
    /// if anything is still alive after the grace period. Falls back to killing
    /// just the immediate child if the pid isn't a process-group leader — i.e.
    /// if `setsid()` didn't happen the way we expect — so an unusual pty
    /// backend degrades to the old behaviour instead of signalling a group we
    /// don't own.
    #[cfg(not(windows))]
    fn terminate(&self) -> Result<(), AppError> {
        #[cfg(unix)]
        if self.pid != 0 && unix::is_group_leader(self.pid) {
            let result = unix::terminate_group(self.pid, TERM_GRACE);
            // The killer makes `portable_pty`'s `wait()` return promptly even
            // if the group signal raced the child's own exit. Harmless once
            // the child is already gone.
            let _ = self.killer.lock().kill();
            return result;
        }

        self.kill_child_only()
    }

    fn kill_child_only(&self) -> Result<(), AppError> {
        if let Err(err) = self.killer.lock().kill() {
            #[cfg(windows)]
            if err.raw_os_error() == Some(0) {
                return Ok(());
            }

            return Err(AppError::ProcessStop(format!("pty kill failed: {err}")));
        }

        Ok(())
    }
}

/// Build the terminator for a PTY-backed service.
///
/// On Windows this creates a Job Object and assigns the already-running child
/// (by PID) to it, so stopping the service kills any grandchildren the child
/// spawns. There is a tiny race: grandchildren forked in the window between
/// `portable_pty`'s spawn and this assignment can still escape — acceptable
/// because dev servers don't fork workers that early in startup. If the job
/// can't be created or the child can't be assigned (e.g. an incompatible
/// pre-existing job), we degrade gracefully to killing just the immediate
/// child. On other platforms the killer is all we use.
#[cfg(windows)]
pub fn pty_terminator(killer: PtyKillHandle, pid: u32) -> ProcessTerminator {
    ProcessTerminator::Pty(PtyTerminator {
        killer,
        job: pty_job_for_pid(pid),
        pid,
    })
}

#[cfg(not(windows))]
pub fn pty_terminator(killer: PtyKillHandle, pid: u32) -> ProcessTerminator {
    ProcessTerminator::Pty(PtyTerminator { killer, pid })
}

#[cfg(windows)]
fn pty_job_for_pid(pid: u32) -> Option<Arc<JobObject>> {
    if pid == 0 {
        return None;
    }
    let job = match JobObject::create() {
        Ok(job) => job,
        Err(err) => {
            eprintln!("[muxly] PTY grandchild tracking off (job create failed): {err}");
            return None;
        }
    };
    if let Err(err) = job.assign_pid(pid) {
        eprintln!("[muxly] PTY grandchild tracking off (assign pid {pid} failed): {err}");
        return None;
    }
    Some(Arc::new(job))
}

#[cfg(windows)]
#[derive(Debug)]
pub struct JobObject {
    handle: HANDLE,
}

#[cfg(windows)]
unsafe impl Send for JobObject {}

#[cfg(windows)]
unsafe impl Sync for JobObject {}

#[cfg(windows)]
impl JobObject {
    fn create() -> Result<Self, AppError> {
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(AppError::ProcessStop(
                "Failed to create Windows Job Object".to_string(),
            ));
        }

        let mut info = unsafe { std::mem::zeroed::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() };
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

        let ok = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                std::ptr::addr_of_mut!(info).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };

        if ok == 0 {
            unsafe {
                CloseHandle(handle);
            }
            return Err(AppError::ProcessStop(
                "Failed to configure Windows Job Object".to_string(),
            ));
        }

        Ok(Self { handle })
    }

    fn assign(&self, child: &Child) -> Result<(), AppError> {
        let ok = unsafe { AssignProcessToJobObject(self.handle, child.as_raw_handle() as HANDLE) };
        if ok == 0 {
            return Err(AppError::ProcessStop(format!(
                "Failed to assign child process {} to Windows Job Object",
                child.id()
            )));
        }

        Ok(())
    }

    /// Assign an already-running process (by PID) to this job. Used for PTY
    /// children: `portable_pty` spawns them for us, so we never hold a
    /// `std::process::Child` and have to re-open the process by id to get a
    /// HANDLE. We request only the rights `AssignProcessToJobObject` needs
    /// (`PROCESS_SET_QUOTA | PROCESS_TERMINATE`) and close the handle straight
    /// away — job membership persists regardless of whether we keep it open.
    fn assign_pid(&self, pid: u32) -> Result<(), AppError> {
        let process = unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid) };
        if process.is_null() {
            return Err(AppError::ProcessStop(format!(
                "OpenProcess failed for pty pid {pid}"
            )));
        }

        let ok = unsafe { AssignProcessToJobObject(self.handle, process) };
        unsafe {
            CloseHandle(process);
        }

        if ok == 0 {
            return Err(AppError::ProcessStop(format!(
                "Failed to assign pty pid {pid} to Windows Job Object"
            )));
        }

        Ok(())
    }

    fn terminate(&self) -> Result<(), AppError> {
        let ok = unsafe { TerminateJobObject(self.handle, 1) };
        if ok == 0 {
            Err(AppError::ProcessStop(
                "Failed to terminate Windows Job Object".to_string(),
            ))
        } else {
            Ok(())
        }
    }
}

#[cfg(windows)]
impl Drop for JobObject {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            unsafe {
                CloseHandle(self.handle);
            }
        }
    }
}

/// Configure platform-specific spawn flags before invoking `Command::spawn`.
///
/// On Windows this sets `CREATE_SUSPENDED` so the child is born paused; we
/// later attach it to a Job Object and resume it atomically with
/// `NtResumeProcess`. Without this, there is a small race window between
/// `spawn` and `AssignProcessToJobObject` where grandchildren could escape the
/// job and survive a `TerminateJobObject` call.
///
/// On Unix this puts the child into its own process group so that signalling
/// `-pid` reaches the whole tree.
#[cfg(windows)]
pub fn configure_process_group(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(CREATE_SUSPENDED);
}

/// Resolve a program name to something `Command::new` can actually spawn.
///
/// On Windows, `CreateProcessW` only appends `.exe`, so an extensionless name
/// like `npm` (whose launcher is `npm.cmd`) fails to start. We search PATH for
/// `<name>.cmd`, `.bat`, then `.exe` and return the first hit. Names that
/// already contain a path separator or an extension — and every name on
/// non-Windows platforms — are returned unchanged.
#[cfg(windows)]
pub fn resolve_program(program: &str) -> std::ffi::OsString {
    use std::ffi::OsString;

    if program.contains('/') || program.contains('\\') || program.contains('.') {
        return OsString::from(program);
    }

    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            for ext in ["cmd", "bat", "exe"] {
                let candidate = dir.join(format!("{program}.{ext}"));
                if candidate.is_file() {
                    return candidate.into_os_string();
                }
            }
        }
    }

    OsString::from(program)
}

#[cfg(not(windows))]
pub fn resolve_program(program: &str) -> std::ffi::OsString {
    std::ffi::OsString::from(program)
}

#[cfg(not(windows))]
pub fn configure_process_group(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let _ = command;
}

#[cfg(windows)]
pub fn process_terminator(child: &Child) -> Result<ProcessTerminator, AppError> {
    let job = Arc::new(JobObject::create()?);
    job.assign(child)?;
    Ok(ProcessTerminator::Job(job))
}

#[cfg(not(windows))]
pub fn process_terminator(child: &Child) -> Result<ProcessTerminator, AppError> {
    Ok(ProcessTerminator::ProcessGroup(child.id()))
}

/// Resume a child that was spawned with `CREATE_SUSPENDED`. No-op on platforms
/// where `configure_process_group` does not suspend the child.
#[cfg(windows)]
pub fn resume_child(child: &Child) -> Result<(), AppError> {
    let status = unsafe { NtResumeProcess(child.as_raw_handle() as HANDLE) };
    if status < 0 {
        return Err(AppError::ProcessStop(format!(
            "NtResumeProcess failed for pid {} (NTSTATUS 0x{:08x})",
            child.id(),
            status as u32
        )));
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn resume_child(_child: &Child) -> Result<(), AppError> {
    Ok(())
}

#[cfg(unix)]
fn terminate_process_tree(pid: u32) -> Result<(), AppError> {
    unix::terminate_group(pid, TERM_GRACE)
}

#[cfg(all(not(unix), not(windows)))]
fn terminate_process_tree(pid: u32) -> Result<(), AppError> {
    let status = std::process::Command::new("kill")
        .arg(pid.to_string())
        .status()
        .map_err(|error| AppError::ProcessStop(format!("Failed to run kill: {error}")))?;

    if status.success() {
        Ok(())
    } else {
        Err(AppError::ProcessStop(format!(
            "kill failed for pid {pid} with status {status}"
        )))
    }
}

/// Process-group signalling for Unix.
///
/// Both spawn paths put the child at the head of its own process group —
/// `configure_process_group` calls `process_group(0)` for the pipe path, and
/// `portable_pty` calls `setsid()` for the PTY path — so in both cases the
/// child's pid *is* its pgid and `killpg` reaches every descendant that hasn't
/// deliberately left the group.
///
/// We signal directly rather than shelling out to `kill(1)`: spawning a process
/// to kill a process is slower, can't report per-signal errno, and gives us no
/// way to poll for liveness between SIGTERM and SIGKILL.
#[cfg(unix)]
mod unix {
    use super::AppError;
    use std::io::Error;
    use std::thread::sleep;
    use std::time::{Duration, Instant};

    /// How often we re-check whether the group has actually died during the
    /// grace period. Fine-grained enough that a well-behaved dev server makes
    /// the Stop button feel instant.
    const POLL_INTERVAL: Duration = Duration::from_millis(50);

    /// True when `pid` heads its own process group, i.e. signalling `-pid`
    /// targets that process and its descendants rather than someone else's
    /// group. Guards against signalling a group we don't own if a spawn path
    /// ever stops calling `setsid`/`setpgid`.
    pub fn is_group_leader(pid: u32) -> bool {
        // SAFETY: getpgid is a pure query; a bad pid yields -1/ESRCH.
        let pgid = unsafe { libc::getpgid(pid as libc::pid_t) };
        pgid >= 0 && pgid == pid as libc::pid_t
    }

    /// SIGTERM the group, wait up to `grace` for it to die, then SIGKILL
    /// whatever is left.
    ///
    /// Windows' `TerminateJobObject` is immediate and unconditional; without
    /// this escalation the Unix path was strictly weaker, and a service that
    /// ignores SIGTERM (or is wedged in an uninterruptible state) survived the
    /// shutdown budget and leaked with the port still bound.
    ///
    /// Assumes the caller has a waiter thread reaping the child — both spawn
    /// paths do. An unreaped zombie still answers `kill(pid, 0)`, so without
    /// one every stop would sit out the full grace period before escalating.
    pub fn terminate_group(pid: u32, grace: Duration) -> Result<(), AppError> {
        if pid == 0 {
            return Err(AppError::ProcessStop(
                "refusing to signal process group 0 (would target our own group)".to_string(),
            ));
        }

        // A failed SIGTERM is not fatal on its own — the group may already be
        // winding down — so fall through to the sweep either way and let that
        // report the outcome.
        if let Err(err) = killpg(pid, libc::SIGTERM) {
            if !is_already_gone(&err) {
                return Err(AppError::ProcessStop(format!(
                    "SIGTERM to process group {pid} failed: {err}"
                )));
            }
        }

        // Give the whole group the grace period to act on SIGTERM. Watching
        // only the leader is not enough: launchers such as npm can exit before
        // the server they spawned has finished flushing state and closing
        // sockets.
        let deadline = Instant::now() + grace;
        while group_alive(pid) && Instant::now() < deadline {
            sleep(POLL_INTERVAL);
        }

        if !group_alive(pid) {
            return Ok(());
        }

        // The group still exists after the grace period. Sweep whatever is
        // left; descendants retain their process-group id after the leader is
        // reparented, so this still reaches an orphaned server.
        match killpg(pid, libc::SIGKILL) {
            Ok(()) => Ok(()),
            Err(err) if is_already_gone(&err) => Ok(()),
            Err(err) => Err(AppError::ProcessStop(format!(
                "SIGKILL to process group {pid} failed: {err}"
            ))),
        }
    }

    /// Whether any process still belongs to the group. Signal 0 performs the
    /// existence/permission check without delivering a signal. On Darwin an
    /// otherwise-dead group containing only unreaped zombies can report EPERM;
    /// every live process spawned in our group shares our uid and is signalable,
    /// so that case counts as drained just like ESRCH.
    fn group_alive(pid: u32) -> bool {
        match killpg(pid, 0) {
            Ok(()) => true,
            Err(err) if is_already_gone(&err) => false,
            Err(_) => true,
        }
    }

    /// Errors that mean no signalable child remains in the group. Darwin uses
    /// EPERM for a group containing only unreaped zombies; see `group_alive`.
    fn is_already_gone(err: &Error) -> bool {
        matches!(err.raw_os_error(), Some(libc::ESRCH) | Some(libc::EPERM))
    }

    fn killpg(pid: u32, signal: libc::c_int) -> Result<(), Error> {
        // SAFETY: killpg with a positive pgid and a valid signal number. Any
        // failure is reported through errno rather than by trapping.
        let result = unsafe { libc::killpg(pid as libc::pid_t, signal) };
        if result == 0 {
            Ok(())
        } else {
            Err(Error::last_os_error())
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    /// Poll for a process disappearing. SIGKILL delivery is not synchronous
    /// with the killing thread, so the assertion needs a bounded wait rather
    /// than an immediate check.
    pub(super) fn wait_until_gone(pid: u32, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            // SAFETY: signal 0 performs existence/permission checks only.
            if unsafe { libc::kill(pid as libc::pid_t, 0) } != 0 {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    /// Spawn a shell that backgrounds a long-lived grandchild and prints its
    /// pid. This is the shape that matters in practice: `npm run dev` is a
    /// launcher whose *child* is the process actually holding the port, so
    /// killing only the process we spawned leaves the port bound.
    fn spawn_with_grandchild() -> (std::process::Child, u32) {
        let mut command = Command::new("/bin/sh");
        command
            .arg("-c")
            .arg("sleep 30 & echo $!; wait")
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        configure_process_group(&mut command);

        let mut child = command.spawn().expect("spawn test shell");
        let stdout = child.stdout.take().expect("piped stdout");
        let mut line = String::new();
        BufReader::new(stdout)
            .read_line(&mut line)
            .expect("read grandchild pid");
        let grandchild = line.trim().parse::<u32>().expect("grandchild pid");

        (child, grandchild)
    }

    #[test]
    fn terminating_a_service_reaps_its_grandchildren() {
        let (child, grandchild) = spawn_with_grandchild();
        assert!(
            !wait_until_gone(grandchild, Duration::from_millis(0)),
            "grandchild should be alive before we terminate anything"
        );

        let terminator = process_terminator(&child).expect("build terminator");
        // Mirror production: both spawn paths run a waiter thread blocked in
        // `wait()`, which reaps the child the instant it dies. Without one the
        // child lingers as a zombie that still answers `kill(pid, 0)`, and the
        // liveness poll below would sit out the whole grace period.
        let reaped = reap_in_background(child);

        let started = Instant::now();
        terminator.terminate().expect("terminate process tree");
        let elapsed = started.elapsed();

        assert!(
            wait_until_gone(grandchild, Duration::from_secs(5)),
            "grandchild {grandchild} survived termination — it would keep holding the port"
        );
        // A service that honours SIGTERM must stop promptly. Burning the full
        // grace period on every stop would make the Stop button feel broken.
        assert!(
            elapsed < TERM_GRACE,
            "stopping a well-behaved service took {elapsed:?}, the whole grace period"
        );
        let _ = reaped.join();
    }

    /// A launcher may exit as soon as it receives SIGTERM while its child is
    /// still performing asynchronous cleanup. The grace period belongs to the
    /// process group, so the child's cleanup must be allowed to finish.
    #[test]
    fn termination_allows_descendant_cleanup_after_leader_exits() {
        let cleanup_file = std::env::temp_dir().join(format!(
            "muxly-shutdown-cleanup-{}-{}.txt",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));

        let mut command = Command::new("/bin/sh");
        command
            .arg("-c")
            .arg(
                "trap 'exit 0' TERM; \
                 /bin/sh -c 'trap \"sleep 0.3; printf done > \\\"$MUXLY_CLEANUP_FILE\\\"; exit 0\" TERM; \
                 echo READY; while :; do sleep 0.1; done' & wait",
            )
            .env("MUXLY_CLEANUP_FILE", &cleanup_file)
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        configure_process_group(&mut command);

        let mut child = command.spawn().expect("spawn cleanup test tree");
        let stdout = child.stdout.take().expect("piped stdout");
        let mut ready = String::new();
        BufReader::new(stdout)
            .read_line(&mut ready)
            .expect("wait for descendant readiness");
        assert_eq!(ready.trim(), "READY");

        let terminator = process_terminator(&child).expect("build terminator");
        let reaped = reap_in_background(child);
        terminator.terminate().expect("terminate process tree");
        let _ = reaped.join();

        let cleanup = std::fs::read_to_string(&cleanup_file)
            .expect("descendant was force-killed before its SIGTERM cleanup completed");
        assert_eq!(cleanup, "done");
        let _ = std::fs::remove_file(cleanup_file);
    }

    /// Reap a child on its own thread, the way both spawn paths do.
    fn reap_in_background(mut child: std::process::Child) -> std::thread::JoinHandle<()> {
        std::thread::spawn(move || {
            let _ = child.wait();
        })
    }

    /// A process that ignores SIGTERM must still die. Windows'
    /// `TerminateJobObject` is unconditional; without the SIGKILL escalation
    /// the Unix path would simply give up and leak the tree.
    #[test]
    fn termination_escalates_to_sigkill_when_sigterm_is_ignored() {
        // The loop matters: a bare `sleep 30` would be killed by the SIGTERM
        // even though the shell ignores it, and the test would pass without
        // ever reaching the escalation. Re-spawning the sleep keeps the shell
        // itself alive and signalable, so only SIGKILL can end this.
        let mut command = Command::new("/bin/sh");
        command
            .arg("-c")
            .arg("trap '' TERM; echo READY; while :; do sleep 0.2; done")
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        configure_process_group(&mut command);

        let mut child = command.spawn().expect("spawn SIGTERM-ignoring shell");
        let pid = child.id();
        let stdout = child.stdout.take().expect("piped stdout");
        let mut ready = String::new();
        BufReader::new(stdout)
            .read_line(&mut ready)
            .expect("wait for signal trap readiness");
        assert_eq!(ready.trim(), "READY");

        // A short grace keeps the test quick; the escalation path is the same.
        let started = Instant::now();
        unix::terminate_group(pid, Duration::from_millis(250)).expect("terminate group");
        assert!(
            started.elapsed() >= Duration::from_millis(250),
            "should have waited out the grace period before escalating"
        );

        let exit = child.wait().expect("reap child");
        assert!(
            !exit.success(),
            "a killed process should not report success, got {exit:?}"
        );
        assert!(
            wait_until_gone(pid, Duration::from_secs(5)),
            "process {pid} ignored SIGTERM and was never escalated to SIGKILL"
        );
    }

    /// Signalling group 0 means "my own process group" — it would take down the
    /// app itself. A zeroed pid should be rejected outright.
    #[test]
    fn refuses_to_signal_process_group_zero() {
        assert!(unix::terminate_group(0, Duration::from_millis(10)).is_err());
    }
}

/// PTY-path termination, tested separately from the pipe path because it
/// reaches the process tree by a different route: `portable_pty` spawns the
/// child itself, and the group-kill only happens if that spawn really did call
/// `setsid()`. If it ever stops doing so, `is_group_leader` sends us down the
/// kill-the-child-only fallback and grandchildren start leaking again — silently.
#[cfg(all(test, unix))]
mod pty_tests {
    use super::*;
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::io::Read;
    use std::time::Duration;

    #[test]
    fn terminating_a_pty_service_reaps_its_grandchildren() {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty");

        // A launcher whose backgrounded child is the process that would be
        // holding the port — and which ignores SIGHUP.
        //
        // That last part is what makes this a real test of the group kill.
        // When a pty's session leader exits, the kernel SIGHUPs the foreground
        // process group, which already reaps a well-behaved grandchild whether
        // or not we do anything. Ignoring SIGHUP (inherited by the background
        // job) removes that safety net and leaves only our explicit killpg —
        // which is the case that actually leaked: a dev server that traps HUP,
        // or that has moved itself out of the foreground group.
        let mut command = CommandBuilder::new("/bin/sh");
        command.arg("-c");
        command.arg("trap '' HUP; sleep 30 & echo READY:$!; wait");
        let mut child = pair.slave.spawn_command(command).expect("spawn pty child");
        let pid = child.process_id().expect("pty child pid");

        // Read the grandchild pid off the pty. Line-buffered through a
        // terminal, so scan the stream rather than assuming one clean read.
        let mut reader = pair.master.try_clone_reader().expect("clone reader");
        let mut seen = String::new();
        let grandchild = loop {
            let mut buf = [0u8; 256];
            let n = reader.read(&mut buf).expect("read pty");
            assert!(n > 0, "pty closed before the child reported its grandchild");
            seen.push_str(&String::from_utf8_lossy(&buf[..n]));
            if let Some(rest) = seen.split("READY:").nth(1) {
                let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
                if seen.split("READY:").nth(1).unwrap().len() > digits.len() && !digits.is_empty() {
                    break digits.parse::<u32>().expect("grandchild pid");
                }
            }
        };

        assert!(
            !super::tests::wait_until_gone(grandchild, Duration::from_millis(0)),
            "grandchild should be alive before termination"
        );

        let killer: PtyKillHandle = Arc::new(Mutex::new(child.clone_killer()));
        let terminator = pty_terminator(killer, pid);
        // Mirror the waiter thread the real spawn path runs.
        let reaped = std::thread::spawn(move || {
            let _ = child.wait();
        });

        terminator.terminate().expect("terminate pty service");

        assert!(
            super::tests::wait_until_gone(grandchild, Duration::from_secs(5)),
            "grandchild {grandchild} survived a PTY service stop — it would keep holding the port"
        );
        let _ = reaped.join();
    }

    /// The group-kill is only correct because the pty child heads its own
    /// process group. Asserted directly so a `portable_pty` change that drops
    /// `setsid()` fails here with a clear reason instead of silently degrading.
    #[test]
    fn pty_children_lead_their_own_process_group() {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty");

        let mut command = CommandBuilder::new("/bin/sh");
        command.arg("-c");
        command.arg("sleep 5");
        let mut child = pair.slave.spawn_command(command).expect("spawn pty child");
        let pid = child.process_id().expect("pty child pid");

        assert!(
            unix::is_group_leader(pid),
            "pty child {pid} is not a process-group leader — the group kill would fall back \
             to killing only the immediate child, leaking grandchildren"
        );

        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Canonical name for a Unix termination signal, e.g. `SIGKILL`.
///
/// Covers the signals a supervised dev process realistically dies from; the
/// numeric form is a readable fallback for anything else. Deliberately not
/// `strsignal`, whose output is a localised prose description ("Killed: 9")
/// rather than the symbolic name people actually search for.
#[cfg(unix)]
pub fn signal_name(signal: i32) -> String {
    let name = match signal {
        libc::SIGHUP => "SIGHUP",
        libc::SIGINT => "SIGINT",
        libc::SIGQUIT => "SIGQUIT",
        libc::SIGILL => "SIGILL",
        libc::SIGABRT => "SIGABRT",
        libc::SIGFPE => "SIGFPE",
        libc::SIGKILL => "SIGKILL",
        libc::SIGBUS => "SIGBUS",
        libc::SIGSEGV => "SIGSEGV",
        libc::SIGPIPE => "SIGPIPE",
        libc::SIGALRM => "SIGALRM",
        libc::SIGTERM => "SIGTERM",
        libc::SIGXCPU => "SIGXCPU",
        libc::SIGXFSZ => "SIGXFSZ",
        _ => return format!("signal {signal}"),
    };
    name.to_string()
}

/// Normalise `portable_pty`'s signal description into the same symbolic name
/// the pipe path reports.
///
/// `portable_pty` only exposes the signal as an already-rendered string, built
/// from `strsignal` — "Killed: 9" on macOS, "Killed" on Linux. Where it carries
/// the number we recover the canonical name so both spawn paths agree; where it
/// doesn't, the prose is passed through as the best available answer.
#[cfg(unix)]
pub fn signal_label(description: &str) -> String {
    let digits: String = description
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(char::is_ascii_digit)
        .collect();

    match digits.parse::<i32>() {
        Ok(signal) => signal_name(signal),
        Err(_) => description.to_string(),
    }
}

#[cfg(all(test, unix))]
mod signal_tests {
    use super::*;

    #[test]
    fn names_the_signals_a_dev_process_dies_from() {
        assert_eq!(signal_name(libc::SIGKILL), "SIGKILL");
        assert_eq!(signal_name(libc::SIGSEGV), "SIGSEGV");
        assert_eq!(signal_name(libc::SIGTERM), "SIGTERM");
    }

    #[test]
    fn unknown_signals_fall_back_to_the_number() {
        assert_eq!(signal_name(4242), "signal 4242");
    }

    /// `portable_pty` hands us prose from `strsignal`, which differs by
    /// platform: macOS includes the number ("Killed: 9"), Linux does not
    /// ("Killed"). Recover the symbolic name when the number is there, and
    /// pass the prose through when it isn't.
    #[test]
    fn recovers_signal_names_from_portable_pty_prose() {
        assert_eq!(signal_label("Killed: 9"), "SIGKILL");
        assert_eq!(signal_label("Segmentation fault: 11"), "SIGSEGV");
        assert_eq!(signal_label("Signal 15"), "SIGTERM");
        assert_eq!(signal_label("Killed"), "Killed");
    }
}
