use crate::error::AppError;
use parking_lot::Mutex;
use portable_pty::ChildKiller;
use std::process::{Child, Command};
use std::sync::Arc;

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
#[derive(Debug, Clone)]
pub struct PtyTerminator {
    killer: PtyKillHandle,
    #[cfg(windows)]
    job: Option<Arc<JobObject>>,
    /// The PTY child's PID, kept so the Windows terminate path can run
    /// `taskkill /T` to walk the live process tree by parent→child links and
    /// catch grandchildren that escaped the Job Object assignment race.
    #[cfg(windows)]
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

    #[cfg(not(windows))]
    fn terminate(&self) -> Result<(), AppError> {
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
pub fn pty_terminator(killer: PtyKillHandle, _pid: u32) -> ProcessTerminator {
    ProcessTerminator::Pty(PtyTerminator { killer })
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
    let group = format!("-{pid}");
    let status = Command::new("kill")
        .arg("-TERM")
        .arg(&group)
        .status()
        .map_err(|error| AppError::ProcessStop(format!("Failed to run kill: {error}")))?;

    if status.success() {
        Ok(())
    } else {
        Err(AppError::ProcessStop(format!(
            "kill failed for process group {group} with status {status}"
        )))
    }
}

#[cfg(all(not(unix), not(windows)))]
fn terminate_process_tree(pid: u32) -> Result<(), AppError> {
    let status = Command::new("kill")
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
