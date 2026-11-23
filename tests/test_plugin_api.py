from __future__ import annotations

import importlib.util
import io
import json
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
DASHBOARD = ROOT / "dashboard"
SPEC = importlib.util.spec_from_file_location("unraid_plugin_api_tested", DASHBOARD / "plugin_api.py")
api = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = api
SPEC.loader.exec_module(api)

app = FastAPI()
app.include_router(api.router)
http = TestClient(app)


def test_health_is_safe_when_unconfigured(monkeypatch):
    monkeypatch.delenv("UNRAID_URL", raising=False)
    monkeypatch.delenv("UNRAID_API_KEY", raising=False)
    response = http.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "configured": False,
        "connected": False,
        "read_only": True,
        "version": "0.4.0",
        "message": "UNRAID_URL is not configured.",
    }


def test_health_never_returns_key(monkeypatch):
    monkeypatch.setenv("UNRAID_URL", "https://tower.local/graphql")
    monkeypatch.setenv("UNRAID_API_KEY", "top-secret")
    response = http.get("/health")
    assert response.status_code == 200
    text = response.text
    assert "top-secret" not in text
    assert response.json()["read_only"] is True
    assert response.json()["endpoint"]["host"] == "tower.local"


def test_overview_maps_configuration_error(monkeypatch):
    monkeypatch.delenv("UNRAID_URL", raising=False)
    monkeypatch.delenv("UNRAID_API_KEY", raising=False)
    response = http.get("/overview")
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "not_configured"


def test_overview_maps_sanitized_upstream_error(monkeypatch):
    def fail(_name):
        raise api.UnraidUpstreamError("unraid_unreachable", "Unable to reach the configured Unraid API.")

    monkeypatch.setattr(api, "execute_query", fail)
    response = http.get("/overview")
    assert response.status_code == 502
    assert response.json() == {
        "detail": {
            "code": "unraid_unreachable",
            "message": "Unable to reach the configured Unraid API.",
        }
    }


_GIB = 2**30


def _stub_upstream(monkeypatch, responses):
    monkeypatch.setenv("UNRAID_URL", "https://fixture.invalid/graphql")
    monkeypatch.setenv("UNRAID_API_KEY", "fixture-key")
    sent = []

    def fake_urlopen(req, **_kwargs):
        query = json.loads(req.data)["query"].strip()
        operation = query.split()[1]
        sent.append(operation)
        return io.BytesIO(json.dumps(responses[operation]).encode())

    monkeypatch.setattr(api._client, "_open_https", fake_urlopen)
    return sent


def test_hardware_success(monkeypatch):
    hardware = {"info": {
        "os": {"hostname": "atlas-fixture"},
        "baseboard": {"manufacturer": "ASRock Rack", "model": "B650D4U", "memMax": 128 * _GIB},
        "cpu": {"manufacturer": "AMD", "brand": "Ryzen 7 7700", "cores": 8, "threads": 16, "speed": 3.8},
        "memory": {"layout": [{"size": str(32 * _GIB), "type": "DDR5"}]},
    }}
    sent = _stub_upstream(monkeypatch, {"HermesUnraidHardware": {"data": hardware}})
    response = http.get("/hardware")
    assert response.status_code == 200
    assert response.json() == {"ok": True, "data": hardware}
    assert sent == ["HermesUnraidHardware"]


def test_hardware_graphql_error_is_sanitized_and_isolated_from_overview(monkeypatch):
    overview = {
        "info": {"versions": {"core": {"unraid": "7.4.1"}}},
        "array": {"state": "STARTED", "parityCheckStatus": {"status": "COMPLETED"}},
        "metrics": {"memory": {"total": str(63 * _GIB), "available": str(42 * _GIB)}},
        "notifications": {"overview": {"unread": {"warning": 2, "alert": 0, "total": 2}}},
    }
    sent = _stub_upstream(monkeypatch, {
        "HermesUnraidHardware": {
            "data": {"info": {"os": {"hostname": "partial-fixture"}}},
            "errors": [{"message": "Cannot query field baseboard; synthetic internal detail at 192.0.2.99"}],
        },
        "HermesUnraidOverview": {"data": overview},
    })
    response = http.get("/hardware")
    assert response.status_code == 424
    assert response.json()["detail"]["code"] == "graphql_error"
    assert "192.0.2.99" not in response.text
    assert "partial-fixture" not in response.text
    overview_response = http.get("/overview")
    assert overview_response.status_code == 200
    assert overview_response.json() == {"ok": True, "data": overview}
    assert sent == ["HermesUnraidHardware", "HermesUnraidOverview"]
