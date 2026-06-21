"""运行时配置：env 默认值 + DB override 合并，供 core/admin 读取。"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

from backend.db.session import SessionLocal
from backend.models import AppConfig

log = logging.getLogger("backend.config")

ENV_KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]{1,127}$")
SECRET_KEY_RE = re.compile(r"(API_KEY|AUTH_TOKEN|SECRET|PASSWORD|TOKEN)$", re.IGNORECASE)
BLOCKLIST_KEYS = frozenset({
    "CLAUDE_CODE_EXECPATH", "PROMPT", "JOB_ID", "CLAUDE_EXTRA_ARGS",
})
PROXY_KEYS = frozenset({"HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"})

APP_CONFIG_ID = 1
_cache_lock = threading.Lock()
_cached: "RuntimeConfig | None" = None


def _env_bool(name: str, default: bool = False) -> bool:
    v = os.getenv(name)
    if v is None:
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int) -> int:
    v = os.getenv(name)
    if v is None:
        return default
    try:
        return int(v)
    except ValueError:
        return default


def get_display_timezone() -> str:
    return os.getenv("DISPLAY_TIMEZONE", "Asia/Shanghai").strip() or "Asia/Shanghai"


def is_allowed_env_key(key: str) -> bool:
    if key in BLOCKLIST_KEYS:
        return False
    if key in PROXY_KEYS:
        return True
    if key.startswith("ANTHROPIC_") or key.startswith("CLAUDE_"):
        return True
    return False


def is_secret_env_key(key: str) -> bool:
    return bool(SECRET_KEY_RE.search(key))


def mask_secret(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "***"
    return value[:4] + "..." + value[-4:]


def _host_claude_defaults() -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in os.environ.items():
        if is_allowed_env_key(k) and v:
            out[k] = v
    return out


@dataclass
class DockerConfig:
    image: str = "ppt-runner:latest"
    network: str = "ppt-isolated"
    memory: str = "4g"
    cpus: str = "2"
    timeout_s: int = 1800


@dataclass
class WatchdogConfig:
    stale_secs: int = 600
    interval_s: int = 60


@dataclass
class RuntimeConfig:
    max_concurrent_jobs: int = 3
    docker: DockerConfig = field(default_factory=DockerConfig)
    watchdog: WatchdogConfig = field(default_factory=WatchdogConfig)
    claude_env_overrides: dict[str, str] = field(default_factory=dict)
    secrets: dict[str, str] = field(default_factory=dict)
    version: int = 1


def _defaults_from_env() -> RuntimeConfig:
    return RuntimeConfig(
        max_concurrent_jobs=_env_int("MAX_CONCURRENT_JOBS", 3),
        docker=DockerConfig(
            image=os.getenv("DOCKER_RUNNER_IMAGE", "ppt-runner:latest"),
            network=os.getenv("DOCKER_RUNNER_NETWORK", "ppt-isolated"),
            memory=os.getenv("DOCKER_RUNNER_MEMORY", "4g"),
            cpus=os.getenv("DOCKER_RUNNER_CPUS", "2"),
            timeout_s=_env_int("DOCKER_RUNNER_TIMEOUT_S", 1800),
        ),
        watchdog=WatchdogConfig(
            stale_secs=_env_int("WATCHDOG_STALE_SECS", 600),
            interval_s=_env_int("WATCHDOG_INTERVAL_S", 60),
        ),
    )


def _load_db_raw() -> tuple[dict, dict, int]:
    with SessionLocal() as s:
        row = s.get(AppConfig, APP_CONFIG_ID)
        if not row:
            return {}, {}, 1
        try:
            settings = json.loads(row.settings_json or "{}")
        except json.JSONDecodeError:
            settings = {}
        try:
            secrets = json.loads(row.secrets_json or "{}")
        except json.JSONDecodeError:
            secrets = {}
        return settings, secrets, row.version


def _merge_runtime() -> RuntimeConfig:
    cfg = _defaults_from_env()
    settings, secrets, version = _load_db_raw()
    cfg.version = version

    if "max_concurrent_jobs" in settings:
        cfg.max_concurrent_jobs = int(settings["max_concurrent_jobs"])

    docker = settings.get("docker") or {}
    if isinstance(docker, dict):
        if "image" in docker:
            cfg.docker.image = str(docker["image"])
        if "network" in docker:
            cfg.docker.network = str(docker["network"])
        if "memory" in docker:
            cfg.docker.memory = str(docker["memory"])
        if "cpus" in docker:
            cfg.docker.cpus = str(docker["cpus"])
        if "timeout_s" in docker:
            cfg.docker.timeout_s = int(docker["timeout_s"])

    wd = settings.get("watchdog") or {}
    if isinstance(wd, dict):
        if "stale_secs" in wd:
            cfg.watchdog.stale_secs = int(wd["stale_secs"])
        if "interval_s" in wd:
            cfg.watchdog.interval_s = int(wd["interval_s"])

    claude_env = settings.get("claude_env") or {}
    if isinstance(claude_env, dict):
        cfg.claude_env_overrides = {k: str(v) for k, v in claude_env.items() if v is not None}

    if isinstance(secrets, dict):
        cfg.secrets = {k: str(v) for k, v in secrets.items() if v}

    return cfg


def get_runtime_config(force_reload: bool = False) -> RuntimeConfig:
    global _cached
    with _cache_lock:
        if _cached is None or force_reload:
            _cached = _merge_runtime()
        return _cached


def reload_runtime_config() -> RuntimeConfig:
    return get_runtime_config(force_reload=True)


def build_claude_env() -> dict[str, str]:
    """合并 host env + DB override + secrets，注入 Docker 容器。"""
    defaults = _host_claude_defaults()
    cfg = get_runtime_config()
    merged: dict[str, str] = dict(defaults)
    merged.update(cfg.claude_env_overrides)
    merged.update(cfg.secrets)
    if "ANTHROPIC_AUTH_TOKEN" in merged and "ANTHROPIC_API_KEY" not in merged:
        merged["ANTHROPIC_API_KEY"] = merged["ANTHROPIC_AUTH_TOKEN"]
    for k in list(merged.keys()):
        if k in BLOCKLIST_KEYS:
            del merged[k]
    return merged


def _validate_env_key(key: str) -> None:
    if not ENV_KEY_RE.match(key):
        raise ValueError(f"invalid env key: {key!r}")
    if key in BLOCKLIST_KEYS:
        raise ValueError(f"env key blocked: {key}")
    if not is_allowed_env_key(key):
        raise ValueError(f"env key not allowed: {key}")


def _validate_env_value(key: str, value: str) -> None:
    if len(value) > 4096:
        raise ValueError(f"env value too long for {key}")
    if key == "ANTHROPIC_BASE_URL" and value:
        p = urlparse(value)
        if p.scheme not in ("http", "https") or not p.netloc:
            raise ValueError("ANTHROPIC_BASE_URL must be http(s)://...")


def _validate_docker_memory(s: str) -> None:
    if not re.match(r"^\d+[bkmgBKMG]?$", s):
        raise ValueError(f"invalid docker memory: {s!r}")


def _validate_docker_cpus(s: str) -> None:
    try:
        if float(s) <= 0:
            raise ValueError
    except ValueError:
        raise ValueError(f"invalid docker cpus: {s!r}")


def get_config_response() -> dict:
    cfg = get_runtime_config()
    defaults = _defaults_from_env()
    settings, secrets_raw, version = _load_db_raw()
    host_claude = _host_claude_defaults()
    claude_overrides = settings.get("claude_env") or {}
    if not isinstance(claude_overrides, dict):
        claude_overrides = {}

    effective_claude = dict(host_claude)
    effective_claude.update(claude_overrides)
    effective_claude.update(secrets_raw if isinstance(secrets_raw, dict) else {})
    if "ANTHROPIC_AUTH_TOKEN" in effective_claude and "ANTHROPIC_API_KEY" not in effective_claude:
        effective_claude["ANTHROPIC_API_KEY"] = effective_claude["ANTHROPIC_AUTH_TOKEN"]
    for k in BLOCKLIST_KEYS:
        effective_claude.pop(k, None)

    all_secret_keys = set(secrets_raw.keys() if isinstance(secrets_raw, dict) else [])
    for k in list(effective_claude.keys()):
        if is_secret_env_key(k):
            all_secret_keys.add(k)

    secrets_meta = {}
    for k in sorted(all_secret_keys):
        val = (secrets_raw or {}).get(k) if isinstance(secrets_raw, dict) else None
        secrets_meta[k] = {
            "set": bool(val),
            "masked": mask_secret(val) if val else None,
        }

    non_secret_effective = {
        k: v for k, v in effective_claude.items()
        if not is_secret_env_key(k)
    }

    return {
        "version": version,
        "max_concurrent_jobs": {
            "default": defaults.max_concurrent_jobs,
            "override": settings.get("max_concurrent_jobs"),
            "effective": cfg.max_concurrent_jobs,
        },
        "docker": {
            "defaults": {
                "image": defaults.docker.image,
                "network": defaults.docker.network,
                "memory": defaults.docker.memory,
                "cpus": defaults.docker.cpus,
                "timeout_s": defaults.docker.timeout_s,
            },
            "overrides": settings.get("docker") or {},
            "effective": {
                "image": cfg.docker.image,
                "network": cfg.docker.network,
                "memory": cfg.docker.memory,
                "cpus": cfg.docker.cpus,
                "timeout_s": cfg.docker.timeout_s,
            },
        },
        "watchdog": {
            "defaults": {
                "stale_secs": defaults.watchdog.stale_secs,
                "interval_s": defaults.watchdog.interval_s,
            },
            "overrides": settings.get("watchdog") or {},
            "effective": {
                "stale_secs": cfg.watchdog.stale_secs,
                "interval_s": cfg.watchdog.interval_s,
            },
        },
        "claude_env": {
            "defaults": host_claude,
            "overrides": claude_overrides,
            "effective": non_secret_effective,
            "secrets": secrets_meta,
        },
    }


def update_runtime_config(patch: dict, admin_user_id: str) -> dict:
    expected = patch.get("expected_version")
    with SessionLocal() as s:
        row = s.get(AppConfig, APP_CONFIG_ID)
        if not row:
            row = AppConfig(id=APP_CONFIG_ID, settings_json="{}", secrets_json="{}", version=1)
            s.add(row)
            s.flush()
        if expected is not None and int(expected) != row.version:
            raise ValueError("version_conflict")

        try:
            settings = json.loads(row.settings_json or "{}")
        except json.JSONDecodeError:
            settings = {}
        try:
            secrets = json.loads(row.secrets_json or "{}")
        except json.JSONDecodeError:
            secrets = {}

        old_max = get_runtime_config().max_concurrent_jobs

        if "max_concurrent_jobs" in patch and patch["max_concurrent_jobs"] is not None:
            v = int(patch["max_concurrent_jobs"])
            if not 1 <= v <= 50:
                raise ValueError("max_concurrent_jobs must be 1..50")
            settings["max_concurrent_jobs"] = v

        if "docker" in patch and isinstance(patch["docker"], dict):
            docker = settings.setdefault("docker", {})
            d = patch["docker"]
            if "image" in d and d["image"] is not None:
                docker["image"] = str(d["image"]).strip()
            if "network" in d and d["network"] is not None:
                docker["network"] = str(d["network"]).strip()
            if "memory" in d and d["memory"] is not None:
                mem = str(d["memory"]).strip()
                _validate_docker_memory(mem)
                docker["memory"] = mem
            if "cpus" in d and d["cpus"] is not None:
                cpus = str(d["cpus"]).strip()
                _validate_docker_cpus(cpus)
                docker["cpus"] = cpus
            if "timeout_s" in d and d["timeout_s"] is not None:
                t = int(d["timeout_s"])
                if not 60 <= t <= 86400:
                    raise ValueError("docker.timeout_s must be 60..86400")
                docker["timeout_s"] = t

        if "watchdog" in patch and isinstance(patch["watchdog"], dict):
            wd = settings.setdefault("watchdog", {})
            w = patch["watchdog"]
            if "stale_secs" in w and w["stale_secs"] is not None:
                stale = int(w["stale_secs"])
                if not 60 <= stale <= 86400:
                    raise ValueError("watchdog.stale_secs must be 60..86400")
                wd["stale_secs"] = stale
            if "interval_s" in w and w["interval_s"] is not None:
                interval = int(w["interval_s"])
                if not 5 <= interval <= 3600:
                    raise ValueError("watchdog.interval_s must be 5..3600")
                wd["interval_s"] = interval
            eff_stale = wd.get("stale_secs", _defaults_from_env().watchdog.stale_secs)
            eff_interval = wd.get("interval_s", _defaults_from_env().watchdog.interval_s)
            if eff_interval >= eff_stale:
                raise ValueError("watchdog.interval_s must be < stale_secs")

        if "claude_env" in patch and isinstance(patch["claude_env"], dict):
            ce = settings.setdefault("claude_env", {})
            for k, v in patch["claude_env"].items():
                _validate_env_key(k)
                if is_secret_env_key(k):
                    raise ValueError(f"use secrets.{k} for secret env keys")
                if v is None:
                    ce.pop(k, None)
                elif v == "":
                    raise ValueError(f"empty string not allowed for claude_env.{k}")
                else:
                    val = str(v)
                    _validate_env_value(k, val)
                    ce[k] = val

        if "secrets" in patch and isinstance(patch["secrets"], dict):
            for k, v in patch["secrets"].items():
                _validate_env_key(k)
                if v is None:
                    secrets.pop(k, None)
                elif v == "":
                    raise ValueError(f"empty string not allowed for secrets.{k}")
                else:
                    val = str(v)
                    _validate_env_value(k, val)
                    secrets[k] = val

        row.settings_json = json.dumps(settings, ensure_ascii=False)
        row.secrets_json = json.dumps(secrets, ensure_ascii=False)
        row.version = row.version + 1
        row.updated_by = admin_user_id
        s.commit()

    reload_runtime_config()
    new_cfg = get_runtime_config()
    bumped_max = new_cfg.max_concurrent_jobs > old_max
    return {"config": get_config_response(), "notify_dispatcher": bumped_max}
