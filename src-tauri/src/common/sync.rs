use std::sync::{Mutex, MutexGuard};

/// Lock a `Mutex`, recovering the guard when the mutex is poisoned.
///
/// A panic in one thread while holding the lock must not permanently break
/// every feature that depends on the mutex (and flood crash.log with
/// cascading panics). The guarded data is plain counters/caches here, so
/// recovering with `into_inner` is the established pattern (see
/// `proxy::engine::get_status`).
pub fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn recovers_guard_from_poisoned_mutex() {
        let mutex = Arc::new(Mutex::new(42));
        let clone = Arc::clone(&mutex);
        // Poison the mutex by panicking while holding the lock.
        let _ = std::thread::spawn(move || {
            let _guard = clone.lock().unwrap();
            panic!("boom");
        })
        .join();

        let guard = lock_unpoisoned(&mutex);
        assert_eq!(*guard, 42);
    }
}
