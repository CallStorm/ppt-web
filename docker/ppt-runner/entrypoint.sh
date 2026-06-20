#!/bin/bash
# ppt-runner 入口：从 env 收 job 参数，exec claude
# 必传 env:
#   PROMPT           - 用户原始 prompt（必）
#   JOB_ID           - job uuid（用于日志关联，可选）
# 可选 env:
#   EXTRA_PROMPT     - 追加到 PROMPT 后面的 system 指令（build_initial_prompt 用）
#   RESUME_SESSION   - 设为 1 时走 --resume 路径（恢复会话）
#   RESUME_SESSION_ID - 要恢复的 session_id
#   CLAUDE_EXTRA_ARGS - 额外透传给 claude 的参数（空格分隔）
set -euo pipefail

# 打印一下启动信息方便 debug
echo "[ppt-runner] job=${JOB_ID:-?} resume=${RESUME_SESSION:-0} ts=$(date -u +%FT%TZ)" >&2

# 校验
if [ -z "${PROMPT:-}" ]; then
  echo "[ppt-runner] ERROR: PROMPT env is required" >&2
  exit 2
fi

# 拼装 claude 命令
# 注：claude CLI 没有 --dir flag。ppt-master 的 project_manager.py init <name> --dir <path>
# 才是用 --dir 的地方，agent 读 prompt 知道要传 /work 给 project_manager。
# claude 的 cwd 在容器里是 /opt/ppt-master（WORKDIR 设定），可以读到 skills/ppt-master/SKILL.md。
# 只放 entrypoint 自己控制的 flag（--print + resume）。stream-json / verbose /
# dangerous skip 等全部由 server 通过 CLAUDE_EXTRA_ARGS 传入，避免双写。
ARGS=(
  --print
)

if [ "${RESUME_SESSION:-0}" = "1" ] && [ -n "${RESUME_SESSION_ID:-}" ]; then
  ARGS=(--resume "${RESUME_SESSION_ID}" "${ARGS[@]}")
fi

# 拼 prompt（原始 + 可选 system 追加）
FULL_PROMPT="${PROMPT}"
if [ -n "${EXTRA_PROMPT:-}" ]; then
  FULL_PROMPT="${PROMPT}

${EXTRA_PROMPT}"
fi

# 透传额外参数
if [ -n "${CLAUDE_EXTRA_ARGS:-}" ]; then
  # shellcheck disable=SC2206
  EXTRA=(${CLAUDE_EXTRA_ARGS})
  ARGS=("${ARGS[@]}" "${EXTRA[@]}")
fi

cd /opt/ppt-master
echo "[ppt-runner] exec: claude ${ARGS[*]}" >&2
exec claude "${ARGS[@]}" -p "${FULL_PROMPT}"
