use crate::logging;
use std::io::BufRead;

/// Classify an engine stdout/stderr line into a log domain.
///
/// `[AUDIT]` is deliberately NOT a marker: engine-core never emits it, but
/// user scripts could print it and forge audit entries. Audit records are
/// only produced host-side via `audit::audit`, so such lines stay "proxy".
fn classify_engine_line(line: &str) -> &'static str {
    if line.contains("[SCRIPT]")
        || line.contains("[RELAYCRAFT][SCRIPT]")
        || line.contains("._rc_")
        || line.contains("_rc_record_hit")
        || line.contains("_rc_log")
    {
        "script"
    } else if line.contains("[PLUGIN]") {
        "plugin"
    } else if line.contains("[CRASH]") || line.contains("Traceback") {
        "crash"
    } else {
        "proxy"
    }
}

pub(super) fn spawn_log_forwarder(stream: Option<impl std::io::Read + Send + 'static>) {
    if let Some(s) = stream {
        let reader = std::io::BufReader::new(s);
        if let Err(e) = std::thread::Builder::new()
            .name("rc-log-forwarder".into())
            .spawn(move || {
                for line in reader.lines().flatten() {
                    let domain = classify_engine_line(&line);
                    logging::write_domain_log(domain, &line).ok();
                }
            })
        {
            // A failed spawn means engine output forwarding (engine.log) is
            // silently off — make it loud instead of swallowing with `.ok()`.
            log::error!("Failed to spawn log forwarder thread: {}", e);
            let _ = logging::write_domain_log(
                "crash",
                &format!("Failed to spawn log forwarder thread: {}", e),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::classify_engine_line;

    #[test]
    fn audit_marker_lines_are_classified_as_proxy() {
        // A user script printing "[AUDIT] ..." must not forge audit records.
        assert_eq!(
            classify_engine_line("[2025-01-01 00:00:00] [AUDIT] fake entry"),
            "proxy"
        );
        assert_eq!(classify_engine_line("[AUDIT] {\"v\":1}"), "proxy");
    }

    #[test]
    fn other_markers_still_classify() {
        assert_eq!(classify_engine_line("x [SCRIPT] y"), "script");
        assert_eq!(classify_engine_line("x [PLUGIN] y"), "plugin");
        assert_eq!(
            classify_engine_line("Traceback (most recent call)"),
            "crash"
        );
        assert_eq!(classify_engine_line("plain engine line"), "proxy");
    }
}
