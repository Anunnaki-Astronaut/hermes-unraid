from __future__ import annotations

import importlib.util
import io
import json
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError

import pytest

ROOT = Path(__file__).resolve().parents[1]
CLIENT_PATH = ROOT / "dashboard" / "unraid_client.py"
SPEC = importlib.util.spec_from_file_location("unraid_client_tested", CLIENT_PATH)
client = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = client
SPEC.loader.exec_module(client)


def test_load_config_requires_url_and_key():
    with pytest.raises(client.UnraidConfigurationError, match="UNRAID_URL"):
        client.load_config({}, {})
    with pytest.raises(client.UnraidConfigurationError, match="UNRAID_API_KEY"):
        client.load_config({}, {"url": "https://tower.local/graphql"})


def test_plain_http_requires_explicit_lan_override():
    with pytest.raises(client.UnraidConfigurationError, match="must use https"):
        client.load_config({"UNRAID_API_KEY": "secret"}, {"url": "http://tower.local/graphql"})
    config = client.load_config(
        {"UNRAID_API_KEY": "secret"},
        {"url": "http://tower.local/graphql", "allow_insecure_http": True},
    )
    assert config.endpoint == "http://tower.local/graphql"


def test_plain_http_rejects_public_hosts_even_with_override():
    with pytest.raises(client.UnraidConfigurationError, match="private or local"):
        client.load_config(
            {"UNRAID_API_KEY": "secret"},
            {"url": "http://8.8.8.8/graphql", "allow_insecure_http": True},
        )


class _FakeConnectedSocket:
    def __init__(self, peer, response=b'HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n{"data": {}}'):
        self.peer = peer
        self.response = response
        self.sent = b""
        self.closed = False

    def setsockopt(self, *_args):
        pass

    def getpeername(self):
        if isinstance(self.peer, OSError):
            raise self.peer
        return self.peer

    def sendall(self, data):
        self.sent += data

    def makefile(self, _mode):
        return io.BytesIO(self.response)

    def close(self):
        self.closed = True


@pytest.mark.parametrize("peer", [("8.8.8.8", 80), ("::ffff:8.8.8.8", 80, 0, 0), OSError()])
def test_lan_connection_refuses_unapproved_or_unknown_peer_before_writing(monkeypatch, peer):
    sock = _FakeConnectedSocket(peer)
    monkeypatch.setattr(client.socket, "create_connection", lambda *_args: sock)
    conn = client._LanHTTPConnection("tower.local")
    try:
        with pytest.raises(OSError):
            conn.send(b"test bytes")
        assert not sock.sent
        assert sock.closed
    finally:
        conn.close()


def test_plain_http_fails_closed_when_peer_cannot_be_checked(monkeypatch):
    sock = _FakeConnectedSocket(OSError("synthetic peer check failure"))
    monkeypatch.setattr(client.socket, "create_connection", lambda *_args: sock)
    config = client.UnraidConfig("http://tower.local/graphql", "test-key")
    with pytest.raises(client.UnraidUpstreamError) as caught:
        client.execute_query("overview", config)
    assert caught.value.code == "unraid_unreachable"
    assert caught.value.message == "Unable to reach the configured Unraid API."
    assert not sock.sent
    assert sock.closed


@pytest.mark.parametrize("peer", [("192.168.1.50", 88), ("fd00::50", 88, 0, 0)])
def test_plain_http_keeps_direct_lan_post_with_custom_port(monkeypatch, peer):
    sock = _FakeConnectedSocket(peer)

    def connect(address, timeout, _source_address):
        assert address == ("tower.local", 88)
        assert timeout == 10
        return sock

    monkeypatch.setenv("http_proxy", "http://proxy.invalid:8080")
    monkeypatch.setenv("no_proxy", "other.invalid")
    monkeypatch.setattr(client.socket, "create_connection", connect)
    monkeypatch.setattr(client, "_secret", lambda name, environ: environ[name])
    config = client.load_config(
        {"UNRAID_API_KEY": "test-key"}, {"url": "http://tower.local:88/graphql", "allow_insecure_http": True}
    )
    assert client.execute_query("overview", config) == {}
    assert sock.sent.startswith(b"POST /graphql HTTP/1.1\r\n")
    assert b"\r\nHost: tower.local:88\r\n" in sock.sent
    assert b"\r\nx-api-key: test-key\r\n" in sock.sent.lower()
    assert sock.closed


def test_plain_http_reports_redirect_as_upstream_error(monkeypatch):
    sock = _FakeConnectedSocket(
        ("127.0.0.1", 80), b"HTTP/1.1 302 Found\r\nLocation: /graphql\r\nContent-Length: 0\r\n\r\n"
    )
    connected = []

    def connect(*_args):
        assert not connected, "The LAN transport must not open a second connection"
        connected.append(True)
        return sock

    monkeypatch.setattr(client.socket, "create_connection", connect)
    config = client.UnraidConfig("http://localhost/graphql", "test-key")
    with pytest.raises(client.UnraidUpstreamError) as caught:
        client.execute_query("overview", config)
    assert caught.value.code == "upstream_http_error"
    assert caught.value.message == "Unraid returned HTTP 302."


def test_plugin_settings_override_legacy_url_environment():
    config = client.load_config(
        {"UNRAID_URL": "https://wrong.local/graphql", "UNRAID_API_KEY": "secret"},
        {"url": "https://tower.local/graphql"},
    )
    assert config.endpoint == "https://tower.local/graphql"


def test_plugin_settings_reads_public_config_shape(monkeypatch):
    import types

    config_module = types.ModuleType("hermes_cli.config")
    setattr(config_module, "load_config_readonly", lambda: {
        "plugins": {
            "entries": {
                "unraid": {
                    "settings": {
                        "url": "https://tower.local/graphql",
                        "allow_insecure_http": False,
                    }
                }
            }
        }
    })
    hermes_cli = types.ModuleType("hermes_cli")
    setattr(hermes_cli, "config", config_module)
    monkeypatch.setitem(sys.modules, "hermes_cli", hermes_cli)
    monkeypatch.setitem(sys.modules, "hermes_cli.config", config_module)

    assert client._plugin_settings() == {
        "url": "https://tower.local/graphql",
        "allow_insecure_http": False,
    }


def test_unscoped_secret_lookup_fails_closed(monkeypatch):
    import types

    class FakeUnscopedSecretError(RuntimeError):
        pass

    secret_scope = types.ModuleType("agent.secret_scope")
    secret_scope.UnscopedSecretError = FakeUnscopedSecretError
    secret_scope.get_secret = lambda *_args, **_kwargs: (_ for _ in ()).throw(FakeUnscopedSecretError())
    agent = types.ModuleType("agent")
    agent.secret_scope = secret_scope
    monkeypatch.setitem(sys.modules, "agent", agent)
    monkeypatch.setitem(sys.modules, "agent.secret_scope", secret_scope)

    assert client._secret("UNRAID_API_KEY", {"UNRAID_API_KEY": "fallback"}) == ""


def test_secret_lookup_error_fails_closed(monkeypatch):
    import types

    secret_scope = types.ModuleType("agent.secret_scope")
    setattr(secret_scope, "UnscopedSecretError", RuntimeError)
    setattr(secret_scope, "get_secret", lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("broken store")))
    agent = types.ModuleType("agent")
    setattr(agent, "secret_scope", secret_scope)
    monkeypatch.setitem(sys.modules, "agent", agent)
    monkeypatch.setitem(sys.modules, "agent.secret_scope", secret_scope)

    assert client._secret("UNRAID_API_KEY", {"UNRAID_API_KEY": "fallback"}) == ""


def test_secret_value_is_not_read_from_plugin_settings():
    with pytest.raises(client.UnraidConfigurationError, match="UNRAID_API_KEY"):
        client.load_config({}, {"url": "https://tower.local/graphql", "api_key": "must-not-be-used"})


@pytest.mark.parametrize(
    "url",
    [
        "file:///graphql",
        "https://user:pass@tower.local/graphql",
        "https://tower.local/other",
        "https://tower.local/graphql?token=secret",
        "https://tower.local/graphql#secret",
    ],
)
def test_endpoint_validation_fails_closed(url):
    with pytest.raises(client.UnraidConfigurationError):
        client.load_config({"UNRAID_URL": url, "UNRAID_API_KEY": "secret"})


def test_execute_query_sends_key_only_in_header(monkeypatch):
    captured = {}

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self):
            return json.dumps({"data": {"info": {"time": "now"}}}).encode()

    def fake_urlopen(request, **kwargs):
        captured["url"] = request.full_url
        captured["headers"] = dict(request.header_items())
        captured["body"] = request.data.decode()
        captured["kwargs"] = kwargs
        return Response()

    monkeypatch.setattr(client, "urlopen", fake_urlopen)
    config = client.UnraidConfig("https://tower.local/graphql", "top-secret", 5)
    result = client.execute_query("overview", config)

    assert result == {"info": {"time": "now"}}
    assert "top-secret" not in captured["url"]
    assert "top-secret" not in captured["body"]
    assert captured["headers"]["X-api-key"] == "top-secret"
    assert captured["kwargs"]["timeout"] == 5
    assert captured["kwargs"]["context"].verify_mode != 0


def test_authentication_error_does_not_leak_key(monkeypatch):
    def denied(*_args, **_kwargs):
        raise HTTPError("https://tower.local/graphql", 401, "Denied top-secret", {}, None)

    monkeypatch.setattr(client, "urlopen", denied)
    config = client.UnraidConfig("https://tower.local/graphql", "top-secret")
    with pytest.raises(client.UnraidUpstreamError) as caught:
        client.execute_query("overview", config)
    assert caught.value.code == "authentication_failed"
    assert "top-secret" not in caught.value.message


def test_network_error_is_sanitized(monkeypatch):
    def failed(*_args, **_kwargs):
        raise URLError("connection to 192.0.2.9 failed with token top-secret")

    monkeypatch.setattr(client, "urlopen", failed)
    config = client.UnraidConfig("https://tower.local/graphql", "top-secret")
    with pytest.raises(client.UnraidUpstreamError) as caught:
        client.execute_query("overview", config)
    assert caught.value.code == "unraid_unreachable"
    assert "192.0.2.9" not in caught.value.message
    assert "top-secret" not in caught.value.message


def test_only_fixed_read_queries_exist():
    assert set(client.QUERIES) == {"overview", "array", "docker", "vms", "notifications", "ups", "capabilities"}
    for query in client.QUERIES.values():
        assert "mutation " not in query.lower()
        assert not query.lstrip().lower().startswith("mutation")
