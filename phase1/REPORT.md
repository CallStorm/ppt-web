# Phase 1 Web MVP — 端到端验证报告

> **状态：✅ 全链路打通**，单用户本地部署可用。
> Phase 1 把 Phase 0 的 CLI 编排器包成 FastAPI + 单页前端，**不重写流水线、不引 Celery/Redis/Docker**，把"快速验证 Web 形态"作为目标。

---

## 1. 架构（一图到底）

```
┌────────────────────────────────────────────────────────────┐
│ 浏览器                                                       │
│  /            ← index.html (GET → FileResponse)            │
│  /static/*    ← StaticFiles 挂载（css/js）                   │
│  EventSource  ← /api/jobs/{id}/events  （SSE）              │
└────────────┬───────────────────────────────────────────────┘
             │ fetch / EventSource
┌────────────▼───────────────────────────────────────────────┐
│ FastAPI  (phase1/server.py)                                │
│   POST /api/jobs                新建 + 启动 run_job 后台任务 │
│   GET  /api/jobs                列表                          │
│   GET  /api/jobs/{id}           详情                          │
│   POST /api/jobs/{id}/resume    注入确认（paused → running）  │
│   POST /api/jobs/{id}/cancel    取消 active job             │
│   GET  /api/jobs/{id}/events    SSE（支持 ?from_seq= 续传）  │
│   GET  /api/jobs/{id}/pptx      下载                          │
└────────────┬───────────────────────────────────────────────┘
             │ asyncio.create_task → run_job
┌────────────▼───────────────────────────────────────────────┐
│ core.run_job / resume_job                                   │
│   - asyncio.Lock 单活动 job 锁                              │
│   - asyncio.to_thread → stream_claude(Popen)                │
│   - on_event 回调 → _enqueue_event (写 DB + fanout Queue)   │
└────────────┬───────────────────────────────────────────────┘
             │ stream-json
┌────────────▼───────────────────────────────────────────────┐
│ claude CLI 子进程（cwd = ppt-master/）                       │
│   跑 SKILL.md 工作流；tool_use 块被解析 → on_event          │
└────────────────────────────────────────────────────────────┘
```

**关键设计选择**：

| 选择 | 理由 |
|---|---|
| 单活动 job 锁（asyncio.Lock） | MVP 假设单用户本机；多用户并发属 Phase 2 |
| SSE 而非 WebSocket | FastAPI 0.115 + StreamingResponse 开箱即用；客户端用 EventSource；天然支持 `Last-Event-ID` 续传 |
| SQLite + WAL | 无需 Postgres；高频事件写入不卡 fsync |
| StaticFiles 不挂 root | 直接挂 `/` 会让 lifespan scope 触发 `assert scope['type'] == 'http'` 抛错；改挂 `/static` + 单独 `/` 路由返回 index.html |
| 不重写 phase0/orchestrator.py | CLI 壳继续 import `phase1.core.run_sync / resume_sync`，前后端共用同一份核心逻辑 |
| `init_runtime` 不清 job | 启动时清残留 job 是 lifespan 单次活；run_job 热路径再调会误把刚建的 job 标 failed |

---

## 2. 文件清单

```
ppt-web/
├── DESIGN.md
├── jobs.db                     # SQLite（WAL）
├── phase0/
│   ├── orchestrator.py         # CLI 壳（继续 import phase1.core）
│   ├── REPORT.md
│   └── fix_preview_fonts.py    # 之前 Phase 0 修中文字体的工具
└── phase1/                     # 本阶段新增
    ├── __init__.py
    ├── core.py                 # ★ 共享编排核心（run_sync / resume_sync / run_job / resume_job）
    ├── db.py                   # SQLAlchemy 引擎 + WAL pragma
    ├── models.py               # Job / Event ORM
    ├── server.py               # ★ FastAPI 路由 + SSE
    ├── _smoke.py               # 之前写的 asyncio 烟雾测试
    ├── requirements.txt
    ├── static/
    │   ├── index.html          # 单页前端
    │   ├── styles.css
    │   └── app.js              # EventSource 消费 + 渲染
    └── REPORT.md               # ← 本文件
```

---

## 3. 端到端验证（实跑数据）

### 3.1 起服务
```bash
.venv/bin/uvicorn phase1.server:app --host 127.0.0.1 --port 8765
# → INFO phase1 server ready
```

### 3.2 健康检查 + 静态资源
```bash
$ curl -sS http://127.0.0.1:8765/api/health
{"ok":true,"active_job":false}

$ curl -sS http://127.0.0.1:8765/static/app.js | head -1
// Phase 1 MVP 前端
```

### 3.3 创建任务（一次完整 e2e）
```bash
$ curl -sS -X POST http://127.0.0.1:8765/api/jobs \
    -H "Content-Type: application/json" \
    -d '{"prompt":"写一份 4 页的 Python 入门 PPT","project_name":"e2e_2"}'
{"id":"1eb120d1-...","project_name":"e2e_2","status":"queued"}
```

### 3.4 订阅 SSE（节选事件）
```
id:1   event:status      {"status":"running"}
id:2   event:agent_text  "我将先阅读 SKILL.md..."
id:3   event:tool        Read SKILL.md (stage=null)
id:6   event:tool        Bash project_manager.py init ... (stage="2 建项目")   ← 阶段识别 ✅
id:25  event:result      session_id=cfbe6e28-...  cost=$0.700  stop_reason=end_turn
id:26  event:status      {"status":"paused"}                                  ← 八点确认暂停 ✅
```

### 3.5 确认 → resume
```bash
$ curl -sS -X POST http://127.0.0.1:8765/api/jobs/1eb120d1-.../resume \
    -H "Content-Type: application/json" \
    -d '{"confirm":"全部 OK，按 8 页继续"}'
{"id":"1eb120d1-...","status":"running"}
```

SSE 续接（from_seq=27）：
```
id:34  event:tool        Write design_spec.md  (stage="3 策略规划(八点确认)")   ← 写入命中 ✅
id:35  event:tool        Write spec_lock.md    (stage="3 策略规划(八点确认)")   ← 区分 Read 关键 ✅
id:53  event:tool        Read executor-base.md (stage=null)
...
```

### 3.6 取消
```bash
$ curl -sS -X POST http://127.0.0.1:8765/api/jobs/1eb120d1-.../cancel
{"id":"1eb120d1-...","status":"cancelled"}
# jobs.db 里 cost_usd=$0.700（运行 ~3min 累计），不烧
```

---

## 4. 修过的坑

| 坑 | 现象 | 修复 |
|---|---|---|
| `init_runtime` 二次调用 | run_job 启动时调 init_runtime → 把刚建的 job 立刻标 failed | 拆分出 `cleanup_stuck_jobs()`，lifespan 单次调 |
| StaticFiles 挂 `/` 触发 assertion | lifespan scope 走到 StaticFiles 抛 `assert scope['type']=='http'` | 改挂 `/static`，根路径单独路由返回 index.html |
| STAGE_RULES 2/3 参 lambda 混用 | 通用 `match(c, f, w)` 调用 2-arg lambda 抛 TypeError → except 吞掉 → 阶段永远 null | 全部统一 3 参签名 |
| pptx 事件无意义触发 | paused/failed 时也发 `{"url":null}` | 仅当 `final.pptx_path` 存在才 emit |
| run_job status 字段不更新 | 任务实际 running/paused，job 表 status 仍是 queued | `_enqueue_event` 里同步镜像 `status` 事件到 Job.status |

---

## 5. 前端能力（app.js）

- 创建表单（项目名可选 + textarea 提示词）
- 历史任务列表（自动 10s 刷新 + 手动刷新按钮）
- 任务详情（status pill、cost、session_id、project_dir、错误信息）
- 事件时间线（type + stage tag + command/file_path 截断 80 字）
- Agent 最新输出区（auto-update via SSE `agent_text`）
- 八点确认面板（status=paused 时显示；textarea 提交即调 `/resume`）
- 取消按钮（active job 时显示）
- 下载按钮（`pptx` 事件触发；a 标签 + download 属性）

---

## 6. 没做（明确划给 Phase 2）

- ❌ 多用户 / 登录 / 配额
- ❌ Celery 任务队列（当前 asyncio.create_task 即可，**进程重启 = 任务丢失**；重启时 cleanup_stuck_jobs 把残留标 failed，但用户必须重新提交）
- ❌ Docker 沙箱（agent 跑在本机、cwd=ppt-master/，**当前是多租户前 unsafe**）
- ❌ 调优 / 可视化批注 / 全局换肤（ppt-master 自带 `update_spec.py` / `svg_editor` / `check_annotations.py` 可挂）
- ❌ 文件上传（当前仅文字输入；DOCX/PDF 用 source_to_md 链路已具备，但前端没接）

---

## 7. 下一步

按 `DESIGN.md` 路线：
- **Phase 2**：登录、JWT、Postgres、对象存储、Docker 沙箱、文件上传
- **Phase 3**：计费、模型分层、admin
