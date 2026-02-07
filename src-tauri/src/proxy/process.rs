use crate::proxy::engine::ProxyEngine;
use std::sync::{Arc, Mutex};

pub struct ProxyState {
    pub engine: Arc<dyn ProxyEngine>,
    pub system: Mutex<sysinfo::System>,
    pub networks: Mutex<sysinfo::Networks>,
    pub last_rx: Mutex<u64>,
    pub last_tx: Mutex<u64>,
    pub last_update: Mutex<std::time::Instant>,
}

impl Drop for ProxyState {
    fn drop(&mut self) {
        let _ = self.engine.stop();
    }
}
