from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException

# Hermes imports dashboard APIs as standalone modules, without package context.
# Load this sibling by path instead of changing the process-wide import path.
_client_name = f"{__name__}_unraid_client"
_client_path = Path(__file__).resolve().with_name("unraid_client.py")
_client_spec = importlib.util.spec_from_file_location(_client_name, _client_path)
if _client_spec is None or _client_spec.loader is None:
    raise ImportError("The Unraid client module is missing.")
_client = importlib.util.module_from_spec(_client_spec)
sys.modules[_client_name] = _client
try:
    _client_spec.loader.exec_module(_client)
except Exception:
    sys.modules.pop(_client_name, None)
    raise

QUERIES = _client.QUERIES
UnraidConfigurationError = _client.UnraidConfigurationError
UnraidUpstreamError = _client.UnraidUpstreamError
endpoint_summary = _client.endpoint_summary
execute_query = _client.execute_query
load_config = _client.load_config

router = APIRouter()
PLUGIN_VERSION = "0.2.0"


def _error(status: int, code: str, message: str) -> None:
    raise HTTPException(status_code=status, detail={"code": code, "message": message})


def _run_query(name: str) -> dict:
    try:
        return {"ok": True, "data": execute_query(name)}
    except UnraidConfigurationError as exc:
        _error(503, "not_configured", str(exc))
    except UnraidUpstreamError as exc:
        _error(exc.status, exc.code, exc.message)


@router.get("/health")
def health() -> dict:
    try:
        config = load_config()
    except UnraidConfigurationError as exc:
        return {
            "ok": True,
            "configured": False,
            "connected": False,
            "read_only": True,
            "version": PLUGIN_VERSION,
            "message": str(exc),
        }
    return {
        "ok": True,
        "configured": True,
        "connected": None,
        "read_only": True,
        "version": PLUGIN_VERSION,
        "endpoint": endpoint_summary(config),
        "available_views": sorted(name for name in QUERIES if name != "capabilities"),
    }


@router.get("/overview")
def overview() -> dict:
    return _run_query("overview")


@router.get("/array")
def array_status() -> dict:
    return _run_query("array")


@router.get("/docker")
def docker_status() -> dict:
    return _run_query("docker")


@router.get("/vms")
def vm_status() -> dict:
    return _run_query("vms")


@router.get("/notifications")
def notification_status() -> dict:
    return _run_query("notifications")


@router.get("/ups")
def ups_status() -> dict:
    return _run_query("ups")


@router.get("/capabilities")
def capabilities() -> dict:
    return _run_query("capabilities")
