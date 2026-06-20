# Phase 0 — 端到端验证编排器

验证 DESIGN.md 中风险最高的技术假设：**服务器能用 claude CLI headless 驱动 ppt-master skill 跑通生成，并支持进度回流 + 八点确认暂停/恢复。**

## 前置

- `claude` CLI 已安装并登录（`claude --version`）。
- `../ppt-master/` 已 vendored（含 `skills/ppt-master/SKILL.md` + scripts）。
- Python 依赖：`python-pptx`、`svglib`、`reportlab`（已在 `../.venv`）。

## 三个被验证的点

1. **驱动**：`claude -p` 以 `cwd=ppt-master/` 跑，初始 prompt 指示读取 `SKILL.md` 并执行 → 出 pptx。
2. **进度回流**：`--output-format stream-json --verbose`，解析 `type:assistant` 的 `tool_use` 块，按命令/文件路径映射到 ppt-master 串行阶段（解析素材→建项目→策略规划→生图→逐页SVG→质检→后处理→导出）。
3. **人在环路**：ppt-master Step 4「八点确认」是 ⛔ BLOCKING。我们在 prompt 里要求 agent 用**聊天确认**（不启动会挂死的 `confirm_ui` server），它在确认点结束本轮 → `run` 检测无 pptx 即判定 paused，落盘 `session_id` 退出；`resume --confirm "..."` 用 `--resume <session_id>` 注入人类确认继续。

## 用法

```bash
cd ppt-web
source .venv/bin/activate

# 1) 启动生成（流式打印阶段时间线，到确认点暂停退出）
python phase0/orchestrator.py run \
  --project mytest \
  --prompt "请把以下内容做成 PPT：人工智能的三次浪潮……（你的文字）"

# 2) 查看状态
cat .phase0/state.json

# 3) 人类确认后恢复（可多次，每次到下一个暂停/完成）
python phase0/orchestrator.py resume --confirm "确认，按推荐方案继续，页数改为 4 页"
```

## 已知约束（Phase 0）

- `--dangerously-skip-permissions`：本地单用户验证用，**Phase 2 必须换成 Docker 沙箱 + 命令白名单**。
- 模型继承 CLI 默认（本环境为 glm-5.2）。ppt-master 官方推荐 Claude Opus；glm-5.2 用于验证「流程能跑通」，不代表质量上限。
- 跳过需外部 API 的可选功能（AI 生图走网络兜底/占位），避免因缺 key 失败。
- 八点确认强制走聊天确认，避免 `confirm_ui/server.py` 在无头模式阻塞。

## 退出码

- `0`：本次 run/resume 已完成（pptx 已导出）。
- `10`：已暂停（等待人类确认），用 `resume` 继续。
- `1`：错误。
