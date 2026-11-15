"""Per-process traffic attribution.

Resolves which local OS process owns a client connection to the proxy by
matching the client-side socket (``laddr.port == client.peername[1]`` and
``raddr.port == client.sockname[1]`` — the listener port the client hit,
which works for forward and reverse/share listeners) against the host TCP
connection table via psutil. IPs are deliberately not compared: dual-stack
makes them brittle, and the port pair is unique per connection on one host.

Only local clients are resolved: loopback peers (IPv4, ``::1`` and
IPv4-mapped ``::ffff:127.0.0.1``) or peers whose address belongs to one of
this machine's interfaces. Remote clients (phones, LAN devices) resolve to
None without any lookup.

Snapshots run on a dedicated single-thread executor (never on the mitmproxy
event loop) and are coalesced: at most one snapshot in flight, and one
snapshot resolves every pending connection at once. A connection opened
before the in-flight snapshot started may await that snapshot; one opened
after it waits for the next.
"""

import asyncio
import concurrent.futures
import ipaddress
import os
import threading
import time
from collections import OrderedDict
from typing import Any, Callable, Dict, List, Optional, Tuple

import psutil

from .utils import setup_logging

ProcessInfo = Dict[str, Any]  # {"pid": int, "name": str, "path": Optional[str]}

_CONN_CACHE_MAX = 4096
_PROC_CACHE_MAX = 512
_SEEN_MAX = 200
_SEEN_PIDS_MAX = 8
_IFACE_TTL_SECONDS = 60.0


class _FallbackConn:
    """Conn view for the per-process fallback scan.

    ``Process.net_connections()`` returns ``pconn`` records that carry NO
    ``pid`` field (the pid is implied by the queried process), unlike the
    system-wide ``sconn`` records. This wrapper exposes ``.pid`` so the
    snapshot matcher can treat both sources uniformly.
    """

    __slots__ = ("pid", "laddr", "raddr")

    def __init__(self, pid: int, laddr: Any, raddr: Any):
        self.pid = pid
        self.laddr = laddr
        self.raddr = raddr


class _PendingResolution:
    """Bookkeeping for one client connection awaiting resolution."""

    __slots__ = ("open_time", "lport", "rport", "future")

    def __init__(self, open_time: float, lport: int, rport: int):
        self.open_time = open_time
        self.lport = lport
        self.rport = rport
        self.future: Optional["asyncio.Future[Optional[ProcessInfo]]"] = None


class ProcessResolver:
    """Resolves client connections to local processes.

    All public methods are exception-safe: they log at debug level and
    return None / no-op on failure, so mitmproxy hook boundaries are never
    broken.
    """

    def __init__(
        self,
        connection_source: Optional[Callable[[], List[Any]]] = None,
        process_factory: Optional[Callable[[int], Any]] = None,
    ):
        self.logger = setup_logging()
        # Injectable for tests: returns an iterable of connection records
        # exposing .pid / .laddr / .raddr (psutil sconn namedtuples).
        self._connection_source = connection_source or self._default_connection_source
        # Injectable for tests: psutil.Process-compatible factory.
        self._process_factory = process_factory or psutil.Process
        self._use_process_fallback = False

        self._executor: Optional[concurrent.futures.ThreadPoolExecutor] = None
        self._executor_lock = threading.Lock()
        self._inflight: Optional[Dict[str, Any]] = None
        self._pending: "OrderedDict[str, _PendingResolution]" = OrderedDict()
        self._cache: "OrderedDict[str, Optional[ProcessInfo]]" = OrderedDict()
        # Worker-thread-only cache: (pid, create_time) -> Optional[{name, path}]
        self._proc_cache: "OrderedDict[Tuple[int, float], Optional[Dict[str, Any]]]" = OrderedDict()

        self._seen: Dict[str, Dict[str, Any]] = {}
        self._seen_lock = threading.Lock()

        self._ifaddrs_cache: Tuple[float, List[Any]] = (0.0, [])

    # ==================== Public API ====================

    def start(self, client: Any) -> None:
        """Fire-and-forget resolution scheduling (client_connected hook)."""
        try:
            if client is None or not self._is_local_client(client):
                return
            cid = getattr(client, "id", None)
            if not cid or cid in self._cache or cid in self._pending:
                return
            ports = self._client_ports(client)
            if ports is None:
                return
            self._pending[cid] = _PendingResolution(
                self._open_time(client), ports[0], ports[1]
            )
            self._ensure_inflight()
        except Exception as e:
            self.logger.debug(f"process resolver start failed: {e}")

    async def resolve(
        self, client: Any, timeout: float = 0.25
    ) -> Optional[ProcessInfo]:
        """Return the resolved ProcessInfo for a client connection.

        Returns the cached result when available, otherwise awaits the
        pending/new lookup up to ``timeout`` seconds. On timeout returns
        None without caching, so a later request can retry.
        """
        try:
            if client is None:
                return None
            cid = getattr(client, "id", None)
            if not cid:
                return None
            if cid in self._cache:
                self._cache.move_to_end(cid)
                return self._cache[cid]
            if not self._is_local_client(client):
                return None
            entry = self._pending.get(cid)
            if entry is None:
                ports = self._client_ports(client)
                if ports is None:
                    return None
                entry = _PendingResolution(
                    self._open_time(client), ports[0], ports[1]
                )
                self._pending[cid] = entry
            if entry.future is None:
                entry.future = asyncio.get_running_loop().create_future()
            # Yield once so concurrently-resolving siblings can register
            # their pending entries first — a single snapshot then covers
            # all of them instead of each resolve spawning its own.
            await asyncio.sleep(0)
            self._ensure_inflight()
            try:
                return await asyncio.wait_for(asyncio.shield(entry.future), timeout)
            except asyncio.TimeoutError:
                return None
        except asyncio.CancelledError:
            raise
        except Exception as e:
            self.logger.debug(f"process resolve failed: {e}")
            return None

    def peek(self, client: Any) -> Optional[ProcessInfo]:
        """Synchronous cache read only; never triggers a lookup."""
        try:
            cid = getattr(client, "id", None) if client is not None else None
            if cid and cid in self._cache:
                self._cache.move_to_end(cid)
                return self._cache[cid]
            return None
        except Exception:
            return None

    def forget(self, client: Any) -> None:
        """Drop cached/pending state for a client (client_disconnected)."""
        try:
            cid = getattr(client, "id", None) if client is not None else None
            if not cid:
                return
            self._cache.pop(cid, None)
            entry = self._pending.pop(cid, None)
            if (
                entry is not None
                and entry.future is not None
                and not entry.future.done()
            ):
                entry.future.set_result(None)
        except Exception as e:
            self.logger.debug(f"process resolver forget failed: {e}")

    def note_seen(self, info: Optional[ProcessInfo]) -> None:
        """Record a successfully attributed process in the recent registry.

        Called by the request path only for flows that reached the capture
        pipeline, so engine-internal connections (``/_relay`` polling from
        the UI's own WebView) never pollute the picker list.
        """
        try:
            if info:
                self._record_seen(info)
        except Exception as e:
            self.logger.debug(f"note seen process failed: {e}")

    def recent_processes(self) -> List[Dict[str, Any]]:
        """Successfully resolved processes, most recently seen first."""
        try:
            with self._seen_lock:
                items = sorted(
                    self._seen.values(),
                    key=lambda e: e.get("lastSeen", 0),
                    reverse=True,
                )
                out = []
                for e in items:
                    item = dict(e)
                    item["pids"] = list(e.get("pids", []))
                    out.append(item)
                return out
        except Exception:
            return []

    # ==================== Client classification ====================

    @staticmethod
    def _client_ports(client: Any) -> Optional[Tuple[int, int]]:
        """(client ephemeral port, proxy listener port) for the socket match."""
        try:
            peername = getattr(client, "peername", None)
            sockname = getattr(client, "sockname", None)
            if not peername or not sockname:
                return None
            lport, rport = peername[1], sockname[1]
            if lport is None or rport is None:
                return None
            return int(lport), int(rport)
        except Exception:
            return None

    @staticmethod
    def _open_time(client: Any) -> float:
        """Connection open time (TCP SYN); falls back to now."""
        try:
            ts = getattr(client, "timestamp_start", None)
            if isinstance(ts, (int, float)) and ts > 0:
                return float(ts)
        except Exception:
            pass
        return time.time()

    def _interface_addresses(self) -> List[Any]:
        """This machine's interface addresses, refreshed at most every 60s."""
        now = time.time()
        ts, addrs = self._ifaddrs_cache
        if now - ts < _IFACE_TTL_SECONDS:
            return addrs
        try:
            fresh: List[Any] = []
            for _iface, addr_list in psutil.net_if_addrs().items():
                for addr in addr_list:
                    try:
                        fresh.append(
                            ipaddress.ip_address(str(addr.address).split("%")[0])
                        )
                    except Exception:
                        continue
            self._ifaddrs_cache = (now, fresh)
            return fresh
        except Exception as e:
            self.logger.debug(f"net_if_addrs failed: {e}")
            return addrs

    def _is_local_client(self, client: Any) -> bool:
        """Whether the client peer is loopback or one of our interfaces."""
        try:
            peername = getattr(client, "peername", None)
            if not peername:
                return False
            host = str(peername[0]).split("%")[0]
            ip = ipaddress.ip_address(host)
            mapped = getattr(ip, "ipv4_mapped", None)
            if mapped is not None:
                ip = mapped
            if ip.is_loopback:
                return True
            return any(ip == iface_ip for iface_ip in self._interface_addresses())
        except Exception:
            return False

    # ==================== Snapshot machinery ====================

    def _get_executor(self) -> concurrent.futures.ThreadPoolExecutor:
        with self._executor_lock:
            if self._executor is None:
                self._executor = concurrent.futures.ThreadPoolExecutor(
                    max_workers=1, thread_name_prefix="relaycraft-proc"
                )
            return self._executor

    def _ensure_inflight(self) -> None:
        """Make sure a snapshot covering all pending entries is in flight."""
        if self._inflight is not None:
            return
        self._submit_snapshot()

    def _submit_snapshot(self) -> bool:
        """Submit one coalesced snapshot to the worker thread.

        Must run on the event loop (uses asyncio.wrap_future).
        """
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return False
        started_at = time.time()
        requests = [
            (cid, entry.lport, entry.rport)
            for cid, entry in self._pending.items()
            if entry.open_time <= started_at and entry.lport is not None
        ]
        if not requests:
            return False
        cf = self._get_executor().submit(self._run_snapshot, requests)
        af = asyncio.wrap_future(cf, loop=loop)
        self._inflight = {
            "started_at": started_at,
            "af": af,
            "requests": requests,
        }
        af.add_done_callback(lambda _f, _sa=started_at: self._on_snapshot_done(_sa))
        return True

    def _on_snapshot_done(self, started_at: float) -> None:
        """Event-loop callback: distribute snapshot results to waiters."""
        inflight = self._inflight
        self._inflight = None
        if inflight is None:
            return
        requests = inflight.get("requests") or []
        try:
            results = inflight["af"].result()
        except Exception as e:
            self.logger.debug(f"process snapshot failed: {e}")
            results = {req[0]: None for req in requests}
        if not isinstance(results, dict):
            results = {req[0]: None for req in requests}
        for cid, info in results.items():
            entry = self._pending.pop(cid, None)
            if entry is None:
                continue
            self._cache_store(cid, info)
            if entry.future is not None and not entry.future.done():
                entry.future.set_result(info)
        # Entries opened after this snapshot started (or registered late)
        # remain pending — the next snapshot resolves them all at once.
        if self._pending:
            self._submit_snapshot()

    # ==================== Snapshot worker (executor thread) ====================

    def _default_connection_source(self) -> List[Any]:
        """Raw TCP connection records.

        Prefers ``psutil.net_connections("tcp")``; on AccessDenied
        permanently switches to the per-process fallback (required on
        macOS without root).
        """
        if self._use_process_fallback:
            return self._process_fallback_connections()
        try:
            return psutil.net_connections("tcp")
        except psutil.AccessDenied:
            self._use_process_fallback = True
            self.logger.debug(
                "psutil.net_connections denied; switching to per-process scan"
            )
            return self._process_fallback_connections()

    @staticmethod
    def _process_fallback_connections(process_iter=None) -> List[Any]:
        iterator = process_iter or psutil.process_iter
        conns: List[Any] = []
        for proc in iterator():
            try:
                pid = proc.pid
                for conn in proc.net_connections("tcp"):
                    try:
                        conns.append(_FallbackConn(pid, conn.laddr, conn.raddr))
                    except Exception:
                        continue
            except psutil.Error:
                continue
            except Exception:
                continue
        return conns

    def _run_snapshot(self, requests: List[Tuple[str, int, int]]) -> Dict[str, Optional[ProcessInfo]]:
        """Worker-thread snapshot: port-pair match + name/path lookup."""
        results: Dict[str, Optional[ProcessInfo]] = {key: None for key, _, _ in requests}
        try:
            conns = self._connection_source()
        except Exception as e:
            self.logger.debug(f"connection snapshot source failed: {e}")
            return results
        port_to_pid: Dict[Tuple[int, int], int] = {}
        own_pid = os.getpid()
        for conn in conns or []:
            try:
                pid = getattr(conn, "pid", None)
                if pid is None or pid == own_pid:
                    continue
                laddr = getattr(conn, "laddr", None)
                raddr = getattr(conn, "raddr", None)
                if not laddr or not raddr:
                    continue
                lport = laddr[1] if isinstance(laddr, (tuple, list)) else getattr(laddr, "port", None)
                rport = raddr[1] if isinstance(raddr, (tuple, list)) else getattr(raddr, "port", None)
                if lport is None or rport is None:
                    continue
                port_to_pid.setdefault((int(lport), int(rport)), int(pid))
            except Exception:
                continue
        pid_to_info: Dict[int, Optional[ProcessInfo]] = {}
        for key, lport, rport in requests:
            pid = port_to_pid.get((lport, rport))
            if pid is None:
                continue
            if pid not in pid_to_info:
                pid_to_info[pid] = self._process_info_for_pid(pid)
            info = pid_to_info[pid]
            if info is not None:
                results[key] = info
        return results

    def _process_info_for_pid(self, pid: int) -> Optional[ProcessInfo]:
        """name/path for a pid, cached by (pid, create_time) against reuse."""
        try:
            proc = self._process_factory(pid)
            create_time = proc.create_time()
        except Exception:
            return None
        key = (int(pid), float(create_time))
        if key in self._proc_cache:
            self._proc_cache.move_to_end(key)
            cached = self._proc_cache[key]
            return dict(cached) if cached else None
        name = ""
        path = None
        try:
            name = proc.name() or ""
        except Exception:
            name = ""
        try:
            exe = proc.exe()
            path = exe if isinstance(exe, str) and exe else None
        except Exception:
            path = None
        info: ProcessInfo = {"pid": int(pid), "name": str(name), "path": path}
        self._proc_cache[key] = info
        while len(self._proc_cache) > _PROC_CACHE_MAX:
            self._proc_cache.popitem(last=False)
        return dict(info)

    # ==================== Result bookkeeping ====================

    def _cache_store(self, cid: str, info: Optional[ProcessInfo]) -> None:
        self._cache[cid] = info
        self._cache.move_to_end(cid)
        while len(self._cache) > _CONN_CACHE_MAX:
            self._cache.popitem(last=False)

    def _record_seen(self, info: ProcessInfo) -> None:
        """Update the recently-seen process registry (loop thread only)."""
        try:
            name = str(info.get("name") or "").strip()
            if not name:
                return
            pid = info.get("pid")
            key = name.lower()
            now = time.time()
            with self._seen_lock:
                entry = self._seen.get(key)
                if entry is None:
                    entry = {
                        "name": name,
                        "path": None,
                        "pids": [],
                        "count": 0,
                        "lastSeen": 0.0,
                    }
                    self._seen[key] = entry
                entry["name"] = name
                entry["path"] = info.get("path")
                entry["lastSeen"] = now
                entry["count"] = int(entry.get("count", 0)) + 1
                pids = entry.setdefault("pids", [])
                if pid is not None and pid not in pids:
                    pids.append(pid)
                    pids.sort()
                    if len(pids) > _SEEN_PIDS_MAX:
                        del pids[:-_SEEN_PIDS_MAX]
                if len(self._seen) > _SEEN_MAX:
                    oldest = min(
                        self._seen,
                        key=lambda k: self._seen[k].get("lastSeen", 0),
                    )
                    self._seen.pop(oldest, None)
        except Exception as e:
            self.logger.debug(f"record seen process failed: {e}")
