from __future__ import annotations

import importlib.util
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
        "version": "0.2.0",
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
