//! Lightweight port-availability probe + helpers for identifying / killing
//! the foreign process that's holding a port.
//!
//! `is_port_available` probes IPv4 and IPv6 localhost listeners, then attempts
//! temporary wildcard binds in both families. A successful connection or a
//! failed bind means something else owns the port. Other bind errors
//! (permission denied, etc.) also count as "in use" — better a false positive
//! than letting the spawn fail later with an opaque message.
//!
//! `find_port_holder_pid` and `kill_external_pid` exist so the UI can offer
//! "stop blocker and restart" / "adopt running instance" when a service
//! exits because something else is already listening on its configured port.
//! We shell out to platform tools instead of pulling in another crate just
//! for this — `netstat` ships with every Windows install and `lsof`/`ss`
//! with every reasonable Linux/macOS dev box.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpListener, TcpStream};
use std::process::Command;
use std::time::Duration;

pub fn is_port_available(port: u16) -> bool {
    // `localhost` commonly resolves to `::1` first on Windows. Checking only
    // 0.0.0.0 therefore misses an IPv6-only Vite/Node listener and lets a
    // restart proceed into a port collision that can persist indefinitely.
    //
    // A bind probe alone is also insufficient on Windows: without explicitly
    // setting SO_EXCLUSIVEADDRUSE, a wildcard bind can succeed while another
    // socket is already listening on a loopback address. Actively connect to
    // both localhost families first, then keep the bind probes as a fallback
    // for sockets bound but not yet listening.
    let timeout = Duration::from_millis(120);
    let ipv4 = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    let ipv6 = SocketAddr::new(IpAddr::V6(Ipv6Addr::LOCALHOST), port);
    if TcpStream::connect_timeout(&ipv4, timeout).is_ok()
        || TcpStream::connect_timeout(&ipv6, timeout).is_ok()
    {
        return false;
    }

    // Probe the families separately, dropping each temporary listener before
    // binding the other so a dual-stack IPv6 socket cannot conflict with our
    // own IPv4 probe.
    let ipv4_available = TcpListener::bind((Ipv4Addr::UNSPECIFIED, port)).is_ok();
    if !ipv4_available {
        return false;
    }
    TcpListener::bind((Ipv6Addr::UNSPECIFIED, port)).is_ok()
}

/// Find a free port at or after `base`, probing up to `max_attempts` ports.
/// Returns the first bindable port, or `None` if every candidate in the range
/// is taken (or the range runs past `u16::MAX`). Used by services with
/// auto-port enabled so a busy preferred port rolls to the next free one.
pub fn find_free_port_from(base: u16, max_attempts: u16) -> Option<u16> {
    (base..=u16::MAX)
        .take(max_attempts as usize)
        .find(|&port| is_port_available(port))
}

/// Return the PID currently listening on `port`, if any. None when the port
/// is free, when no tool we can call is available, or when parsing fails —
/// callers treat None as "we don't know who has it" rather than "free".
pub fn find_port_holder_pid(port: u16) -> Option<u32> {
    #[cfg(windows)]
    {
        find_pid_via_netstat(port)
    }
    #[cfg(not(windows))]
    {
        find_pid_via_lsof(port).or_else(|| find_pid_via_ss(port))
    }
}

/// Forcibly terminate a process we did not spawn ourselves. Used by the
/// "stop blocker and restart" affordance — we hand it whatever PID
/// `find_port_holder_pid` reported.
pub fn kill_external_pid(pid: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        // /T also kills the whole tree, which matters for `next dev` and
        // friends that fork a worker holding the listening socket.
        let status = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F", "/T"])
            .status()
            .map_err(|err| format!("Failed to run taskkill: {err}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("taskkill exited with status {status}"))
        }
    }
    #[cfg(not(windows))]
    {
        // SIGTERM gives the target a chance to clean up; if it ignores us
        // the port stays held and the user will see another conflict
        // (signalled clearly by the next port re-scan). We avoid SIGKILL
        // here so adopted dev servers can flush their state.
        let status = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status()
            .map_err(|err| format!("Failed to run kill: {err}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("kill exited with status {status}"))
        }
    }
}

#[cfg(windows)]
fn find_pid_via_netstat(port: u16) -> Option<u32> {
    // `netstat -ano -p TCP` columns look like:
    //   Proto  Local Address    Foreign Address  State        PID
    //   TCP    0.0.0.0:3000     0.0.0.0:0        LISTENING    32236
    // We grep for a LISTENING row whose local address ends with :port.
    let output = Command::new("netstat")
        .args(["-ano", "-p", "TCP"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let needle = format!(":{port}");
    for line in text.lines() {
        if !line.contains("LISTENING") {
            continue;
        }
        let mut fields = line.split_whitespace();
        let _proto = fields.next();
        let local = fields.next().unwrap_or("");
        if !local.ends_with(&needle) {
            continue;
        }
        // Skip the remaining fixed columns (foreign address, state) and grab
        // the trailing PID column. Done this way so a future column added
        // by Windows doesn't shift the parse.
        let pid_str = line.split_whitespace().last().unwrap_or("");
        if let Ok(pid) = pid_str.parse::<u32>() {
            // Skip pid 0 (the System Idle Process / unbound entries netstat
            // sometimes lists for ephemeral local addresses).
            if pid != 0 {
                return Some(pid);
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn find_pid_via_lsof(port: u16) -> Option<u32> {
    // `lsof -nP -iTCP:port -sTCP:LISTEN -t` prints one PID per line for any
    // process listening on the given TCP port. We take the first.
    let output = Command::new("lsof")
        .args([
            "-nP",
            &format!("-iTCP:{port}"),
            "-sTCP:LISTEN",
            "-t",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines().next()?.trim().parse::<u32>().ok()
}

#[cfg(not(windows))]
fn find_pid_via_ss(port: u16) -> Option<u32> {
    // Fallback for distros that ship `ss` but not `lsof`. Output looks like
    //   LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=32236,fd=22))
    let output = Command::new("ss")
        .args(["-lntp", &format!("sport = :{port}")])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        if let Some(start) = line.find("pid=") {
            let rest = &line[start + 4..];
            let end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
            if let Ok(pid) = rest[..end].parse::<u32>() {
                return Some(pid);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::is_port_available;
    use std::net::{Ipv4Addr, Ipv6Addr, TcpListener};

    #[test]
    fn detects_ipv4_listener() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();

        assert!(!is_port_available(port));
    }

    #[test]
    fn detects_ipv6_listener_when_ipv6_is_available() {
        let Ok(listener) = TcpListener::bind((Ipv6Addr::LOCALHOST, 0)) else {
            return;
        };
        let port = listener.local_addr().unwrap().port();

        assert!(!is_port_available(port));
    }
}
