from __future__ import annotations

import ipaddress
import json
import os
import socket
import ssl
from dataclasses import dataclass
from typing import Any, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen


class UnraidConfigurationError(ValueError):
    pass


class UnraidUpstreamError(RuntimeError):
    def __init__(self, code: str, message: str, *, status: int = 502):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


@dataclass(frozen=True)
class UnraidConfig:
    endpoint: str
    api_key: str
    timeout_seconds: float = 10.0


def _validate_endpoint(raw: str, *, allow_insecure_http: bool = False) -> str:
    value = raw.strip()
    if not value:
        raise UnraidConfigurationError("UNRAID_URL is not configured.")
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"}:
        raise UnraidConfigurationError("UNRAID_URL must use http or https.")
    if not parsed.hostname:
        raise UnraidConfigurationError("UNRAID_URL must include a hostname.")
    if parsed.username or parsed.password:
        raise UnraidConfigurationError("UNRAID_URL must not contain embedded credentials.")
    if parsed.query or parsed.fragment:
        raise UnraidConfigurationError("UNRAID_URL must not contain a query or fragment.")
    if parsed.scheme == "http":
        if not allow_insecure_http:
            raise UnraidConfigurationError(
                "UNRAID_URL must use https unless UNRAID_ALLOW_INSECURE_HTTP is explicitly enabled for a trusted LAN."
            )
        if not _is_private_host(parsed.hostname):
            raise UnraidConfigurationError("Plain HTTP is allowed only for private or local Unraid hosts.")
    path = parsed.path.rstrip("/") or "/graphql"
    if path != "/graphql":
        raise UnraidConfigurationError("UNRAID_URL must point to the /graphql endpoint.")
    return urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))


def _plugin_settings() -> Mapping[str, Any]:
    try:
        from hermes_cli.config import load_config_readonly

        config = load_config_readonly() or {}
        plugins = config.get("plugins") if isinstance(config, Mapping) else None
        entries = plugins.get("entries") if isinstance(plugins, Mapping) else None
        entry = entries.get("unraid") if isinstance(entries, Mapping) else None
        settings = entry.get("settings") if isinstance(entry, Mapping) else None
        return settings if isinstance(settings, Mapping) else {}
    except Exception:
        return {}


def _secret(name: str, environ: Mapping[str, str]) -> str:
    try:
        from agent.secret_scope import UnscopedSecretError, get_secret

        try:
            value = get_secret(name, None)
        except UnscopedSecretError:
            return ""
        except Exception:
            return ""
    except ImportError:
        value = environ.get(name)
    return str(value or "").strip()


def load_config(environ: Mapping[str, str] | None = None, settings: Mapping[str, Any] | None = None) -> UnraidConfig:
    source: Mapping[str, str] = os.environ if environ is None else environ
    current = _plugin_settings() if settings is None else settings
    raw_allow = current.get("allow_insecure_http", source.get("UNRAID_ALLOW_INSECURE_HTTP", ""))
    allow_insecure_http = raw_allow is True or str(raw_allow).strip().lower() in {"1", "true", "yes"}
    endpoint = _validate_endpoint(
        str(current.get("url") or source.get("UNRAID_URL", "")),
        allow_insecure_http=allow_insecure_http,
    )
    api_key = _secret("UNRAID_API_KEY", source)
    if not api_key:
        raise UnraidConfigurationError("UNRAID_API_KEY is not configured.")
    try:
        timeout = float(source.get("UNRAID_TIMEOUT_SECONDS", "10"))
    except ValueError as exc:
        raise UnraidConfigurationError("UNRAID_TIMEOUT_SECONDS must be numeric.") from exc
    if not 1 <= timeout <= 30:
        raise UnraidConfigurationError("UNRAID_TIMEOUT_SECONDS must be between 1 and 30.")
    return UnraidConfig(endpoint=endpoint, api_key=api_key, timeout_seconds=timeout)


def _is_private_host(hostname: str) -> bool:
    lowered = hostname.lower().rstrip(".")
    if lowered in {"localhost"} or lowered.endswith((".local", ".lan", ".home", ".internal")):
        return True
    try:
        return ipaddress.ip_address(lowered).is_private or ipaddress.ip_address(lowered).is_loopback
    except ValueError:
        pass
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)}
    except OSError:
        return False
    return bool(addresses) and all(
        ipaddress.ip_address(address).is_private or ipaddress.ip_address(address).is_loopback
        for address in addresses
    )


def endpoint_summary(config: UnraidConfig) -> dict[str, Any]:
    parsed = urlsplit(config.endpoint)
    return {
        "configured": True,
        "scheme": parsed.scheme,
        "host": parsed.hostname,
        "port": parsed.port,
        "path": parsed.path,
        "private_host": _is_private_host(parsed.hostname or ""),
    }


QUERIES: dict[str, str] = {
    "overview": """
query HermesUnraidOverview {
  info {
    time
    os { platform distro release uptime }
    system { manufacturer model serial }
    cpu { manufacturer brand cores }
    versions { core { unraid api } }
  }
  metrics {
    cpu { percentTotal }
    memory { total available used free percentTotal }
  }
  array {
    state
    capacity { kilobytes { total used free } }
    parityCheckStatus { status progress speed errors }
  }
  notifications {
    overview { unread { info warning alert total } }
    warningsAndAlerts { id title subject description importance timestamp }
  }
}
""",
    "array": """
query HermesUnraidArray {
  array {
    state
    capacity { kilobytes { total used free } }
    disks {
      id name device type status temp size
      fsSize fsUsed fsFree
      numErrors
      isSpinning
    }
    parityCheckStatus { status progress speed errors }
  }
}
""",
    "docker": """
query HermesUnraidDocker {
  docker {
    containers {
      id names image created state status autoStart autoStartOrder autoStartWait
      lanIpPorts sizeRootFs sizeRw sizeLog
      projectUrl supportUrl webUiUrl iconUrl
      isOrphaned isUpdateAvailable
    }
  }
}
""",
    "vms": """
query HermesUnraidVms {
  vms { domains { id name state } }
}
""",
    "notifications": """
query HermesUnraidNotifications {
  notifications {
    overview { unread { info warning alert total } archive { info warning alert total } }
    warningsAndAlerts { id title subject description importance timestamp link }
  }
}
""",
    "ups": """
query HermesUnraidUps {
  upsDevices {
    id name model status
    battery { chargeLevel estimatedRuntime health }
    power { inputVoltage outputVoltage loadPercentage }
  }
}
""",
    "capabilities": """
query HermesUnraidCapabilities {
  info { versions { core { unraid api } } }
}
""",
}


def execute_query(name: str, config: UnraidConfig | None = None) -> dict[str, Any]:
    if name not in QUERIES:
        raise KeyError(name)
    cfg = config or load_config()
    body = json.dumps({"query": QUERIES[name]}).encode("utf-8")
    request = Request(
        cfg.endpoint,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "x-api-key": cfg.api_key,
            "User-Agent": "Hermes-Unraid/0.2.0",
        },
    )
    try:
        with urlopen(request, timeout=cfg.timeout_seconds, context=ssl.create_default_context()) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        if exc.code in {401, 403}:
            raise UnraidUpstreamError("authentication_failed", "Unraid rejected the API key.", status=401) from exc
        raise UnraidUpstreamError("upstream_http_error", f"Unraid returned HTTP {exc.code}.") from exc
    except (URLError, TimeoutError, socket.timeout) as exc:
        raise UnraidUpstreamError("unraid_unreachable", "Unable to reach the configured Unraid API.") from exc
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise UnraidUpstreamError("invalid_upstream_response", "Unraid returned an invalid response.") from exc

    if not isinstance(payload, dict):
        raise UnraidUpstreamError("invalid_upstream_response", "Unraid returned an invalid response.")
    if payload.get("errors"):
        messages = [str(error.get("message", "GraphQL error")) for error in payload["errors"] if isinstance(error, dict)]
        safe_message = "The installed Unraid API did not satisfy this read-only query."
        if messages:
            safe_message += " Check API version and key permissions."
        raise UnraidUpstreamError("graphql_error", safe_message, status=424)
    data = payload.get("data")
    if not isinstance(data, dict):
        raise UnraidUpstreamError("missing_data", "Unraid returned no data.")
    return data
