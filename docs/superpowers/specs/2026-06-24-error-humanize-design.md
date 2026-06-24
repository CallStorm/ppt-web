# 错误信息友好化设计

日期：2026-06-24
范围：把作品卡片/详情页上对用户不友好的机器错误（如 `stop_reason=stop_sequence`、`auto-resume bailed: ... hallucinated`、docker 报错等）翻译为友好中文；未知错误原样透传。

## 背景

失败任务的 `Job.error_message` 直接来自 runner/调度层的原始字符串，最近在卡片上新增了"错误行"（Task 4，单行截断显示 `error_message`），导致用户在卡片上直接看到 `stop_reason=stop_sequence` 这类机器术语。这些字符串源自 `backend/runner/sync.py`、`backend/runtime/dispatcher.py`、`backend/runtime/watchdog.py`、`backend/runtime/init.py`、`backend/runner/docker.py`。

## 目标

- 卡片/详情页上对用户展示的失败原因为友好中文。
- 已知机器术语模式被翻译；无法识别的字符串**原样透传**（不吞错误）。
- 原始机器串写入服务器日志（带 job_id），便于运维排查。
- 无 schema 变更、无前端改动。

## 决策（已与用户确认）

1. **映射在后端做**（选项 #1）—— 一处 `humanize_error` 辅助函数，存储的就是友好文本。
2. **原始串只进日志**（选项 #1）—— 不新增 DB 列。
3. **未知错误原样透传**（选项 #3）—— 仅翻译已知术语，绝不把未知错误吞成通用文案。

## 设计

### 辅助函数：`backend/runner/errors.py`（新建）

纯函数 `humanize_error(raw: str | None) -> str | None`，无副作用、无 I/O。用有序 (前缀/子串, 友好文案) 列表做匹配，返回第一个命中；未命中则原样返回。`None`/空串返回 `None`（由调用方处理）。

映射表（顺序敏感，更具体的前缀在前）：

| 模式（前缀/子串，大小写敏感除非注明） | 友好文案 |
|---|---|
| `auto-resume bailed` | AI 未生成有效内容，请调整需求后重试 |
| `auto-resume claude CLI 失败` | AI 服务调用失败，请稍后重试 |
| `claude CLI 失败` | AI 服务调用失败，请稍后重试 |
| `stop_reason=` | AI 生成中断，请重试 |
| `runner exception:` | 生成过程异常，请重试 |
| `resume exception:` | 生成过程异常，请重试 |
| `watchdog:` | 生成超时未响应，请重试 |
| `server restart interrupted` | 服务重启中断了任务，请重试 |
| docker（任一：`Docker daemon is not available` / `docker CLI not found` / `docker info timed out` / `docker info failed` / `docker image inspect failed`，大小写不敏感） | 运行环境未就绪，请联系管理员 |
| 其他 | 原样返回 raw |

注意：`auto-resume claude CLI 失败` 必须排在 `claude CLI 失败` 之前（前者是后者前缀）。

**透传（不翻译，已清晰/由人填写）：**
- `"user cancelled"` / `"admin cancelled"` —— 已清晰。
- 管理员 `body.reason` 自由文本 —— 透传。

### 幂等性

`humanize_error` 对友好化后的串幂等：友好输出（如「AI 生成中断，请重试」）不命中任何模式 → 原样返回。因此 dispatcher 处对 `final.get("error_message")` 再次包裹是安全 no-op，无需 guard。

### 集成点

1. **`backend/runner/sync.py`** —— `run_sync` 与 `resume_sync` 返回的 `final` dict 里 `error_message`：在 final 构造后、仅当 `status == "failed"` 时 `humanize_error(error_message)`。覆盖 `stop_reason=`、`auto-resume bailed`、`claude CLI 失败`、`str(e)` 异常路径。
2. **`backend/runtime/dispatcher.py`** —— `docker_err`（行 166、289）、`f"runner exception: {e}"`（237）、`f"resume exception: {e}"`（334）包裹。`final.get("error_message")`（220、324）已是 sync.py 友好化过的，保持原样（幂等）。
3. **`backend/runtime/watchdog.py`** —— `watchdog:` 串（行 67）包裹。
4. **`backend/runtime/init.py`** —— `server restart interrupted` 串（行 27）包裹。
5. **`backend/runner/docker.py`** —— `check_docker_runner_ready` 返回错误串**前**友好化（一处改，所有调用方受益）；原始串 `log.warning`。

不触碰：`jobs.py:288`、`runtime/jobs.py:73`、`admin/router.py` 取消 + `body.reason`。

### 日志（Q1/Q2）

原始串在调用点（有 job_id 处）写日志，helper 内不记日志：
- sync.py：`log.warning("job %s failed raw error: %s", job_id, raw)` 后存友好文案。
- dispatcher.py / watchdog.py / init.py：同模式。
- docker.py：`log.warning("docker runner not ready: %s", raw)` 后返回友好文案。

### 前端

无改动。卡片错误行与详情页已渲染 `job.error_message`，存储值变友好后自动显示友好文案。

## 验证

无测试框架。验证 = 后端语法检查 + `humanize_error` 临时单测（`python -c` import，断言每个模式映射到对应友好串、未知串透传、None/空返回 None）。

## 影响文件

- 新建：`backend/runner/errors.py`
- 修改：`backend/runner/sync.py`、`backend/runtime/dispatcher.py`、`backend/runtime/watchdog.py`、`backend/runtime/init.py`、`backend/runner/docker.py`

## 非目标

- 无新 DB 列 / 无 migration。
- 无前端改动。
- 不翻译取消/admin reason。
- 未知错误无通用兜底（透传）。
- 不改 SSE 事件结构（`error` 事件 payload 的 message 源自同一处，friendly error_message 在 final 写入时流入）。
