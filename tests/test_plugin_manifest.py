import importlib.util
import json
import sys
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]


def test_description_identifies_live_desktop_monitor_not_diagnostics():
    manifest = yaml.safe_load((ROOT / "plugin.yaml").read_text())
    description = manifest["description"].lower()

    for term in ("live", "read-only", "desktop", "monitor", "array", "disks", "docker", "vms", "alerts", "graphql"):
        assert term in description
    assert "not an analyzer or repair tool" in description


def test_manifest_and_runtime_versions_match_release(monkeypatch):
    version = "0.4.0"
    plugin = yaml.safe_load((ROOT / "plugin.yaml").read_text())
    dashboard = json.loads((ROOT / "dashboard" / "manifest.json").read_text())
    spec = importlib.util.spec_from_file_location("unraid_plugin_api_manifest_tested", ROOT / "dashboard" / "plugin_api.py")
    assert spec and spec.loader
    api = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = api
    spec.loader.exec_module(api)

    assert plugin["version"] == version
    assert dashboard["version"] == version
    assert api.PLUGIN_VERSION == version
    monkeypatch.setattr(
        api,
        "load_config",
        lambda: api._client.UnraidConfig("https://tower.local/graphql", "test-key"),
    )
    assert api.health()["version"] == version

    def capture_request(request, **_kwargs):
        assert request.get_header("User-agent") == f"Hermes-Unraid/{version}"
        raise OSError("request captured")

    monkeypatch.setattr(api._client, "_open_https", capture_request)
    try:
        api._client.execute_query(
            "overview",
            api._client.UnraidConfig("https://tower.local/graphql", "test-key"),
        )
    except OSError as exc:
        assert str(exc) == "request captured"
    else:
        raise AssertionError("Expected the request capture to stop the query")
