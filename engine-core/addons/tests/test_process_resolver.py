import asyncio
import os
import sys
import time
import unittest
from types import SimpleNamespace

# Add parent addon directory to sys.path
current_dir = os.path.dirname(os.path.abspath(__file__))
addons_dir = os.path.dirname(current_dir)
sys.path.append(addons_dir)

from core.process_resolver import ProcessResolver


def _conn(pid, lport, rport, lip="127.0.0.1", rip="127.0.0.1"):
    return SimpleNamespace(pid=pid, laddr=(lip, lport), raddr=(rip, rport))


def _client(cid, peer_port, listen_port=8080, peer_ip="127.0.0.1", ts=None):
    return SimpleNamespace(
        id=cid,
        peername=(peer_ip, peer_port),
        sockname=("127.0.0.1", listen_port),
        timestamp_start=ts if ts is not None else time.time(),
    )


class _FakeProc:
    def __init__(self, pid, name=None, path=None, ct=1234.5, exe_error=None):
        self._pid = pid
        self._name = name if name is not None else f"proc{pid}"
        self._path = path
        self._ct = ct
        self._exe_error = exe_error

    def create_time(self):
        return self._ct

    def name(self):
        return self._name

    def exe(self):
        if self._exe_error is not None:
            raise self._exe_error
        return self._path


def _make_resolver(conns=None, procs=None, calls=None):
    """Resolver with fake OS sources; iface addrs restricted to loopback."""
    state = {"calls": calls if calls is not None else []}

    def source():
        state["calls"].append(1)
        if callable(conns):
            return conns()
        return list(conns or [])

    proc_map = procs or {}

    def factory(pid):
        if pid in proc_map:
            return proc_map[pid]
        return _FakeProc(pid)

    resolver = ProcessResolver(connection_source=source, process_factory=factory)
    # No non-loopback interface addresses in tests.
    resolver._ifaddrs_cache = (time.time(), [])
    return resolver, state


class TestProcessResolverLocality(unittest.TestCase):
    def setUp(self):
        self.addCleanup(self._reset)

    def _reset(self):
        pass

    def test_loopback_clients_are_local(self):
        resolver, _ = _make_resolver()
        for ip in ("127.0.0.1", "::1", "::ffff:127.0.0.1"):
            with self.subTest(ip=ip):
                self.assertTrue(resolver._is_local_client(_client("c", 1, peer_ip=ip)))

    def test_remote_client_is_not_local(self):
        resolver, _ = _make_resolver()
        self.assertFalse(resolver._is_local_client(_client("c", 1, peer_ip="203.0.113.1")))

    def test_interface_address_client_is_local(self):
        import ipaddress

        resolver, _ = _make_resolver()
        resolver._ifaddrs_cache = (time.time(), [ipaddress.ip_address("192.168.1.10")])
        self.assertTrue(resolver._is_local_client(_client("c", 1, peer_ip="192.168.1.10")))
        self.assertFalse(resolver._is_local_client(_client("c", 1, peer_ip="192.168.1.11")))

    def test_process_fallback_injects_pid(self):
        """Per-process pconn records have no .pid — the wrapper must add it."""
        # pconn-like record WITHOUT a pid attribute (real macOS shape).
        pconn = SimpleNamespace(
            fd=3,
            laddr=("127.0.0.1", 50001),
            raddr=("127.0.0.1", 8080),
        )

        class _FakeProcess:
            pid = 4321

            def net_connections(self, kind):
                assert kind == "tcp"
                return [pconn]

        conns = ProcessResolver._process_fallback_connections(
            process_iter=lambda: [_FakeProcess()]
        )
        self.assertEqual(len(conns), 1)
        self.assertEqual(conns[0].pid, 4321)
        self.assertEqual(conns[0].laddr, ("127.0.0.1", 50001))
        self.assertEqual(conns[0].raddr, ("127.0.0.1", 8080))

    def test_remote_client_never_triggers_snapshot(self):
        calls = []
        resolver, state = _make_resolver(conns=[_conn(4321, 50001, 8080)], calls=calls)
        client = _client("remote", 50001, peer_ip="203.0.113.1")
        resolver.start(client)
        self.assertNotIn("remote", resolver._pending)
        self.assertIsNone(resolver._inflight)
        self.assertEqual(state["calls"], [])


class TestProcessResolverAsync(unittest.IsolatedAsyncioTestCase):
    async def test_resolve_matches_client_side_pid(self):
        own = os.getpid()
        conns = [
            # Proxy's own accepted socket (reversed ports) — must be ignored.
            _conn(own, 8080, 50001),
            # Same port pair but owned by the proxy itself — filtered by pid.
            _conn(own, 50001, 8080),
            # A conn with pid=None — filtered.
            _conn(None, 50001, 8080),
            # Another local client on the same listener — different lport.
            _conn(9999, 50002, 8080),
            # Unrelated upstream conn.
            _conn(7777, 40000, 80, lip="10.0.0.2", rip="93.184.216.34"),
            # The real client socket.
            _conn(4321, 50001, 8080),
        ]
        procs = {4321: _FakeProc(4321, name="curl", path="/usr/bin/curl")}
        calls = []
        resolver, _ = _make_resolver(conns=conns, procs=procs, calls=calls)

        info = await resolver.resolve(_client("c1", 50001))
        self.assertIsNotNone(info)
        self.assertEqual(info["pid"], 4321)
        self.assertEqual(info["name"], "curl")
        self.assertEqual(info["path"], "/usr/bin/curl")
        self.assertEqual(len(calls), 1)

    async def test_concurrent_resolves_share_one_snapshot(self):
        conns = [
            _conn(111, 50001, 8080),
            _conn(222, 50002, 8080),
            _conn(333, 50003, 8080),
        ]
        calls = []
        resolver, _ = _make_resolver(conns=conns, calls=calls)
        clients = [_client(f"c{i}", 50000 + i) for i in range(1, 4)]

        results = await asyncio.gather(*(resolver.resolve(c) for c in clients))
        self.assertEqual([r["pid"] for r in results], [111, 222, 333])
        self.assertEqual(len(calls), 1)

    async def test_miss_is_cached_as_none(self):
        calls = []
        resolver, _ = _make_resolver(conns=[_conn(111, 50001, 8080)], calls=calls)
        client = _client("miss", 59999)

        self.assertIsNone(await resolver.resolve(client))
        self.assertIn("miss", resolver._cache)
        self.assertIsNone(resolver._cache["miss"])

        # Second resolve must be a cache hit — no new snapshot.
        self.assertIsNone(await resolver.resolve(client))
        self.assertEqual(len(calls), 1)

    async def test_timeout_returns_none_without_caching(self):
        import threading

        gate = threading.Event()

        def blocking_source():
            gate.wait(5)
            return [_conn(4321, 50001, 8080)]

        calls = []

        def source():
            calls.append(1)
            return blocking_source()

        procs = {4321: _FakeProc(4321, name="curl")}
        resolver = ProcessResolver(connection_source=source, process_factory=lambda pid: procs.get(pid, _FakeProc(pid)))
        resolver._ifaddrs_cache = (time.time(), [])

        client = _client("slow", 50001)
        result = await resolver.resolve(client, timeout=0.05)
        self.assertIsNone(result)
        self.assertNotIn("slow", resolver._cache)

        gate.set()
        await asyncio.sleep(0.3)

        # Once the snapshot lands, the same client resolves from cache.
        info = await resolver.resolve(client)
        self.assertIsNotNone(info)
        self.assertEqual(info["pid"], 4321)
        self.assertEqual(len(calls), 1)

    async def test_forget_drops_cache_and_pending(self):
        calls = []
        resolver, _ = _make_resolver(
            conns=[_conn(4321, 50001, 8080)], calls=calls
        )
        client = _client("c1", 50001)
        info = await resolver.resolve(client)
        self.assertEqual(info["pid"], 4321)

        resolver.forget(client)
        self.assertIsNone(resolver.peek(client))
        self.assertNotIn("c1", resolver._cache)

        # Re-resolve triggers a fresh snapshot.
        info2 = await resolver.resolve(client)
        self.assertEqual(info2["pid"], 4321)
        self.assertEqual(len(calls), 2)

    async def test_start_then_resolve_uses_cache(self):
        calls = []
        resolver, _ = _make_resolver(
            conns=[_conn(4321, 50001, 8080)], calls=calls
        )
        client = _client("c1", 50001)
        resolver.start(client)
        self.assertIn("c1", resolver._pending)

        info = await resolver.resolve(client)
        self.assertEqual(info["pid"], 4321)
        # Second call is a pure cache read.
        self.assertEqual((await resolver.resolve(client))["pid"], 4321)
        self.assertEqual(len(calls), 1)

    async def test_recent_processes_ordering_and_fields(self):
        conns = [
            _conn(111, 50001, 8080),
            _conn(222, 50002, 8080),
        ]
        procs = {
            111: _FakeProc(111, name="Curl", path="/usr/bin/curl"),
            222: _FakeProc(222, name="Python", path="/usr/bin/python3"),
        }
        resolver, _ = _make_resolver(conns=conns, procs=procs)
        info_a = await resolver.resolve(_client("a", 50001))
        resolver.note_seen(info_a)
        await asyncio.sleep(0.01)
        info_b = await resolver.resolve(_client("b", 50002))
        resolver.note_seen(info_b)

        # Resolution alone must NOT populate the recent registry — only
        # note_seen (called from the capture path) does.
        resolver2, _ = _make_resolver(conns=conns, procs=procs)
        await resolver2.resolve(_client("a", 50001))
        self.assertEqual(resolver2.recent_processes(), [])

        recent = resolver.recent_processes()
        self.assertEqual(len(recent), 2)
        # Most recently seen first.
        self.assertEqual(recent[0]["name"], "Python")
        self.assertEqual(recent[1]["name"], "Curl")
        self.assertEqual(recent[1]["pids"], [111])
        self.assertEqual(recent[1]["path"], "/usr/bin/curl")
        self.assertGreater(recent[1]["count"], 0)
        self.assertGreater(recent[1]["lastSeen"], 0)

    async def test_seen_registry_caps(self):
        resolver, _ = _make_resolver()
        import core.process_resolver as pr

        old_max, old_pids = pr._SEEN_MAX, pr._SEEN_PIDS_MAX
        try:
            pr._SEEN_MAX = 5
            pr._SEEN_PIDS_MAX = 3
            for i in range(8):
                resolver.note_seen({"pid": i, "name": f"proc{i}", "path": None})
                time.sleep(0.001)
            recent = resolver.recent_processes()
            self.assertEqual(len(recent), 5)
            self.assertEqual(recent[0]["name"], "proc7")

            resolver.note_seen({"pid": 100, "name": "multi", "path": None})
            for p in (101, 102, 103, 104):
                resolver.note_seen({"pid": p, "name": "multi", "path": None})
            multi = [e for e in resolver.recent_processes() if e["name"] == "multi"][0]
            self.assertLessEqual(len(multi["pids"]), 3)
            self.assertEqual(multi["pids"], sorted(multi["pids"]))
        finally:
            pr._SEEN_MAX, pr._SEEN_PIDS_MAX = old_max, old_pids


if __name__ == "__main__":
    unittest.main()
