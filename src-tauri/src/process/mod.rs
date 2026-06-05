mod platform;
mod port;
mod shell;
mod spawn;
mod spawn_pty;

use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

pub use platform::{configure_process_group, resolve_program, resume_child, ProcessTerminator};
pub use spawn::spawn_process;
pub use spawn_pty::{
    resize_service_pty, spawn_service_pty, write_service_pty, ServicePtyRegistry,
};

/// A monotonically increasing tag identifying a single run of a service.
///
/// Registries key on `service_id`, which is stable across restarts, so a fast
/// stop→start of the same service can leave the *old* run's waiter thread
/// racing the *new* run's insert. The token lets cleanup be a compare-and-
/// remove: a waiter only drops the entry it still owns, so a stale waiter can
/// never clobber the live run. Mint one per run via [`ProcessRegistry::next_token`].
pub type RunToken = u64;

#[derive(Debug, Clone)]
pub struct RunningProcess {
    pub terminator: ProcessTerminator,
    pub stop_requested: bool,
    pub run_token: RunToken,
}

#[derive(Default)]
pub struct ProcessRegistry {
    processes: Mutex<HashMap<String, RunningProcess>>,
    next_token: AtomicU64,
}

impl ProcessRegistry {
    /// Mint a fresh run token. Both spawn paths call this once per run and
    /// thread the value through the registry entry, the PTY session, and the
    /// waiter so all three agree on which run they belong to.
    pub fn next_token(&self) -> RunToken {
        self.next_token.fetch_add(1, Ordering::Relaxed)
    }

    pub fn is_running(&self, service_id: &str) -> bool {
        self.processes().contains_key(service_id)
    }

    pub fn insert(&self, service_id: String, process: RunningProcess) {
        self.processes().insert(service_id, process);
    }

    pub fn mark_stop_requested(&self, service_id: &str) -> Option<ProcessTerminator> {
        let mut processes = self.processes();
        let process = processes.get_mut(service_id)?;
        process.stop_requested = true;
        Some(process.terminator.clone())
    }

    /// Remove the entry for `service_id` only if it still belongs to `token`.
    /// Returns `None` (leaving the map untouched) when a newer run has already
    /// replaced it — the caller is a stale waiter and must not disturb the
    /// live run.
    pub fn remove_if_token(&self, service_id: &str, token: RunToken) -> Option<RunningProcess> {
        let mut processes = self.processes();
        match processes.get(service_id) {
            Some(process) if process.run_token == token => processes.remove(service_id),
            _ => None,
        }
    }

    pub fn running_terminators(&self) -> Vec<ProcessTerminator> {
        self.processes()
            .values()
            .map(|process| process.terminator.clone())
            .collect()
    }

    fn processes(&self) -> parking_lot::MutexGuard<'_, HashMap<String, RunningProcess>> {
        self.processes.lock()
    }
}
