use crate::logging;
use std::io::BufRead;

pub(super) fn spawn_log_forwarder(stream: Option<impl std::io::Read + Send + 'static>) {
    if let Some(s) = stream {
        let reader = std::io::BufReader::new(s);
        std::thread::Builder::new()
            .name("rc-log-forwarder".into())
            .spawn(move || {
                for line in reader.lines().flatten() {
                    // Classify log domain based on content markers
                    let domain = if line.contains("[SCRIPT]")
                        || line.contains("[RELAYCRAFT][SCRIPT]")
                        || line.contains("._rc_")
                        || line.contains("_rc_record_hit")
                        || line.contains("_rc_log")
                    {
                        "script"
                    } else if line.contains("[PLUGIN]") {
                        "plugin"
                    } else if line.contains("[AUDIT]") {
                        "audit"
                    } else if line.contains("[CRASH]") || line.contains("Traceback") {
                        "crash"
                    } else {
                        "proxy"
                    };
                    logging::write_domain_log(domain, &line).ok();
                }
            })
            .ok();
    }
}
