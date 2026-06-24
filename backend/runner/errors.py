"""把对用户不友好的机器错误串翻译为友好中文。

纯函数，无 I/O、无日志。未知串原样透传（不吞错误）。对友好化后的串
幂等——友好输出不命中任何模式 → 原样返回。
"""
from __future__ import annotations

# 顺序敏感：更具体的前缀在前（auto-resume claude CLI 失败 是 claude CLI 失败 的前缀）。
_PREFIX_MAP: list[tuple[str, str]] = [
    ("auto-resume bailed", "AI 未生成有效内容，请调整需求后重试"),
    ("auto-resume claude CLI 失败", "AI 服务调用失败，请稍后重试"),
    ("claude CLI 失败", "AI 服务调用失败，请稍后重试"),
    ("stop_reason=", "AI 生成中断，请重试"),
    ("runner exception:", "生成过程异常，请重试"),
    ("resume exception:", "生成过程异常，请重试"),
    ("watchdog:", "生成超时未响应，请重试"),
    ("server restart interrupted", "服务重启中断了任务，请重试"),
]

# docker 错误（check_docker_runner_ready 返回的几种），大小写不敏感匹配。
_DOCKER_SUBSTRINGS: tuple[str, ...] = (
    "docker daemon is not available",
    "docker cli not found",
    "docker info timed out",
    "docker info failed",
    "docker image inspect failed",
    "docker image",
)
_DOCKER_FRIENDLY = "运行环境未就绪，请联系管理员"


def humanize_error(raw: str | None) -> str | None:
    """raw → 友好文案。None/空 → None；已知模式 → 友好中文；未知 → 原样返回。"""
    if not raw:
        return raw  # None 或 ""
    for prefix, friendly in _PREFIX_MAP:
        if raw.startswith(prefix):
            return friendly
    low = raw.lower()
    if any(s in low for s in _DOCKER_SUBSTRINGS):
        return _DOCKER_FRIENDLY
    return raw
