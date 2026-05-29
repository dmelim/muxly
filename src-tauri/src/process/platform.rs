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
        Threading::CREATE_SUSPENDED,
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
    /// Service spawned through `portable_pty`. The PTY child doesn't belong to
    /// our Job Object / process group, so we kill it directly through its own
    /// killer handle. Grandchildren forked by a PTY child are not tracked —
    /// dev servers don't typically fork, so this is acceptable.
    Pty(PtyKillHandle),
}

impl ProcessTerminator {
    pub fn terminate(&self) -> Result<(), AppError> {
        match self {
            #[cfg(windows)]
            Self::Job(job) => job.terminate(),
            #[cfg(not(windows))]
            Self::ProcessGroup(pid) => terminate_process_tree(*pid),
            Self::Pty(handle) => {
                if let Err(err) = handle.lock().kill() {
                    #[cfg(windows)]
                    if err.raw_os_error() == Some(0) {
                        return Ok(());
                    }

                    return Err(AppError::ProcessStop(format!("pty kill failed: {err}")));
                }

                Ok(())
            }
        }
    }
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
