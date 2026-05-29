mod platform;
mod spawn;
mod spawn_pty;

use parking_lot::Mutex;
use std::collections::HashMap;

pub use platform::{configure_process_group, resolve_program, resume_child, ProcessTerminator};
pub use spawn::spawn_process;
pub use spawn_pty::{
    resize_service_pty, spawn_service_pty, write_service_pty, ServicePtyRegistry,
};

#[derive(Debug, Clone)]
pub struct RunningProcess {
    pub terminator: ProcessTerminator,
    pub stop_requested: bool,
}

#[derive(Default)]
pub struct ProcessRegistry {
    processes: Mutex<HashMap<String, RunningProcess>>,
}

impl ProcessRegistry {
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

    pub fn remove(&self, service_id: &str) -> Option<RunningProcess> {
        self.processes().remove(service_id)
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
