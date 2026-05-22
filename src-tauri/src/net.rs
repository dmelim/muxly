//! Lightweight port-availability probe.
//!
//! We try to bind a TcpListener on `0.0.0.0:port` for an instant. If the bind
//! succeeds the port is free; we drop the listener immediately. Any
//! `AddrInUse` error means something else has it. We treat other errors
//! (permission denied, etc.) as "in use" too — better a false positive than
//! letting the spawn fail later with an opaque message.

use std::net::TcpListener;

pub fn is_port_available(port: u16) -> bool {
    TcpListener::bind(("0.0.0.0", port)).is_ok()
}
