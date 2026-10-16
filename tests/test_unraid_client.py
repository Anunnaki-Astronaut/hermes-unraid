from __future__ import annotations

import importlib.util
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
