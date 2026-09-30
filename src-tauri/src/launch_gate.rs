//! Serialize child creation and registration with application shutdown.
use crate::error::AppError;
use parking_lot::{Mutex, MutexGuard};

#[derive(Default)]
pub struct LaunchGate(Mutex<bool>);

impl LaunchGate {
    /// Acquire after slow preparation (such as PATH discovery), before spawning.
    /// Hold until the child is registered and its cleanup threads are installed.
    pub fn enter(&self) -> Result<MutexGuard<'_, bool>, AppError> {
        let closed = self.0.lock();
        if *closed {
            return Err(AppError::ConfigUnavailable("Application is shutting down".into()));
        }
        Ok(closed)
    }

    /// Wait for child setup already in progress, then reject all later launches.
    /// Call before taking the shutdown registry snapshot.
    pub fn close(&self) {
        *self.0.lock() = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{mpsc, Arc};

    #[test]
    fn shutdown_waits_for_registration_and_rejects_late_launches() {
        let gate = Arc::new(LaunchGate::default());
        let launch = gate.enter().unwrap();
        let closer = Arc::clone(&gate);
        let (requested_tx, requested_rx) = mpsc::channel();
        let shutdown = std::thread::spawn(move || {
            requested_tx.send(()).unwrap();
            closer.close();
        });
        requested_rx.recv().unwrap();
        // Shutdown cannot seal the gate while child setup owns it.
        assert!(gate.0.try_lock().is_none());
        drop(launch);
        shutdown.join().unwrap();
        assert!(gate.enter().is_err());
        gate.close(); // Repeated exit events are safe.
        assert!(gate.enter().is_err());
    }

    #[test]
    fn failed_launch_releases_gate_for_retry() {
        let gate = LaunchGate::default();
        drop(gate.enter().unwrap());
        assert!(gate.enter().is_ok());
    }
}
