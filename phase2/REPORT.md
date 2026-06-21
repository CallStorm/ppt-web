# Phase 2 — 多用户 + 文件上传 + per-user 隔离

> **状态：✅ 端到端验证通过**。Phase 0/1 单用户 MVP 升级到多用户 SaaS 雏形。
>
> 本阶段：登录鉴权、文件上传、per-user project 隔离。**未做**：Postgres、Docker 沙箱、对象存储、调优 UI。

---

## 1. 一图到底

```
┌────────────────────────────────────────────────────────────┐
│ 浏览器  (index.html + app.js 状态机)                       │
│  未登录 → 登录/注册卡   登录后 → 主界面                     │
└────────────┬───────────────────────────────────────────────┘
             │  fetch (credentials: 'same-origin')
┌────────────▼───────────────────────────────────────────────┐
│ FastAPI  (backend/main.py)                                │
│  /api/auth/{register,login,logout,me}                      │
│  /api/jobs               (multipart: prompt + files)        │
│  /api/jobs/{id}/{events,pptx,resume,cancel}                │
│   ↑ Depends(get_current_user)  + ownership check           │
│   ↑ JWT cookie (HttpOnly, SameSite=Lax)                    │
└────────────┬───────────────────────────────────────────────┘
             │
┌────────────▼───────────────────────────────────────────────┐
│ backend/runtime/  (run_job / resume_job 编排)                │
│   ↑ 从 Job 行读 user_id → project_root_for(uid, job_id)    │
│   ↑ build_initial_prompt 注入 project_root + upload 列表    │
│   ↑ run_sync / resume_sync 用 per-user project_root         │
└────────────┬───────────────────────────────────────────────┘
             │  claude CLI (cwd=ppt-master, --dir <project_root>)
┌────────────▼───────────────────────────────────────────────┐
│ ppt-master 脚本 (init / import-sources --copy / etc.)      │
│   产物落到  data/users/<uid>/projects/<job_id>/projects/   │
│            <name>_<format>_<date>/{sources,exports,svg...}│
└────────────────────────────────────────────────────────────┘
```

---

## 2. 关键设计决策

| 决策 | 选 | 理由 |
|---|---|---|
| 鉴权 | 邮箱密码 + bcrypt + JWT (HS256) | 用户选定；最简；后续可加 OAuth |
| JWT 存放 | HttpOnly + SameSite=Lax cookie，**Secure 仅 https** | 同源无 CORS；`credentials: 'same-origin'` 兜底 |
| `cwd` 隔离 | **cwd 保持 `ppt-master/`** + `init <name> --dir <project_root>` | agent 的 Read 工具按 cwd 解析 `skills/ppt-master/SKILL.md` 相对路径，换 cwd 会找不到 |
| `run_job` 入参 | **不加 user_id 参数**——自己从 DB 读 | 避免冗余授权面 + layout 迁移不用数据修复 |
| 文件上传 | server staging 到 `data/users/<uid>/uploads/<job_id>/`，agent 跑 `import-sources --copy` | 不 fork ppt-master 的转换逻辑 |
| 并发 | **保留全局单活动 job 锁** | ppt-master 子脚本绑死端口 5050/…；UI 明示"单 job 串行" |
| 配额 | `POST /api/jobs` 预扣 1，runner 异常或 413 时 refund；cancel 不退 | 防止误点刷爆；真计费留 Phase 3 |
| 数据迁移 | 一次性 `migrate_v1_to_v2()` 删 jobs.db 重建 | MVP 无真实数据可保留 |
| 前端架构 | **单一 `index.html` + `app.js` 状态机**：先 `GET /api/auth/me` 决定 login/main | 不分 login.html/home.html |

---

## 3. 文件清单

```
ppt-web/
├── DESIGN.md                       # 旧
├── jobs.db                         # users + jobs + events
├── data/                           # per-user 数据（gitignore）
│   └── users/<user_id>/
│       ├── uploads/<job_id>/       # 原始上传
│       └── projects/<job_id>/      # 该 job 的 project_root
│           └── projects/<name>_<format>_<date>/   # ppt-master 建
├── backend/                        # FastAPI 后端（backend.main:app）
│   ├── main.py                     # app 入口 + lifespan
│   ├── api/routes/                 # auth, jobs, health, spa
│   ├── runtime/                    # dispatcher, events, queue, watchdog
│   ├── runner/                     # claude 执行 + sync CLI
│   ├── auth/, db/, models/, admin/
│   └── scripts/smoke.py            # 无 HTTP 冒烟测试
├── webui/                          # React SPA（Vite 构建 → webui/dist）
├── phase2/
│   └── REPORT.md                   # ← 本文件
└── ppt-master/                     # 仓库自带，未改
```

---

## 4. 端到端验证

### 4.1 启动

```bash
rm -f jobs.db jobs.db-wal jobs.db-shm  # 首次会触发 migrate_v1_to_v2
PPT_WEB_JWT_SECRET="<32+ char random>" .venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8765
# → INFO backend server ready
```

**生产必设 `PPT_WEB_JWT_SECRET`**：dev 模式启动时会随机生成并 console warning，但重启即失效，所有 token 失效。

### 4.2 注册 / 登录

```bash
# 注册 A
curl -c /tmp/a.jar -X POST http://127.0.0.1:8765/api/auth/register \
  -H "Content-Type: application/json" -d '{"email":"a@x.com","password":"hunter2"}'
# → {"id":"<uid_a>","email":"a@x.com","role":"user","quota_credits":100}

# 注册 B
curl -c /tmp/b.jar -X POST http://127.0.0.1:8765/api/auth/register \
  -H "Content-Type: application/json" -d '{"email":"b@x.com","password":"hunter2"}'

# me
curl -b /tmp/a.jar http://127.0.0.1:8765/api/auth/me
# → {"id":"<uid_a>","email":"a@x.com","role":"user","quota_credits":100}
```

### 4.3 多用户隔离（所有权校验）

| 操作 | A 视角 | B 视角 |
|---|---|---|
| `GET /api/jobs` | 仅 A 的 jobs | 仅 B 的 jobs |
| `GET /api/jobs/<A_job_id>` | 200 | **403** |
| `GET /api/jobs/<A_job_id>/events` | SSE 流 | **403** |
| `POST /api/jobs/<A_job_id>/cancel` | 200 | **403** |
| `POST /api/jobs/<A_job_id>/resume` | 200 | **403** |
| `GET /api/jobs/<A_job_id>/pptx` | 下载 | **403** |

admin (`role='admin'`) 跳过 ownership 校验（手动改 DB 即可提升）。

### 4.4 文件上传

```bash
# A 创建 job，附 PDF
curl -b /tmp/a.jar -X POST http://127.0.0.1:8765/api/jobs \
  -F "prompt=基于 PDF 写 4 页摘要" \
  -F "files=@/path/to/test.pdf"
# → {"id":"<job_id>","project_name":"web_<8>","status":"queued","uploads":1}

# staging 验证
ls data/users/<uid_a>/uploads/<job_id>/
# → test.pdf

# agent 看到的 prompt 中包含 staged 路径，会跑：
# python3 skills/ppt-master/scripts/project_manager.py import-sources <project_path> \
#   /abs/path/to/data/users/<uid>/uploads/<job_id>/test.pdf --copy
```

**大小限制**：单文件 25MB、总 50MB；超出 413 且 **自动 refund 配额**。

### 4.5 per-user project 隔离

agent 跑了 `init` 后（可在 SSE `tool` 事件里看到）：

```
data/users/<uid_a>/projects/<job_id>/projects/<name>_ppt169_<YYYYMMDD>/
  README.md
  sources/        ← import-sources --copy 把 uploads 拷过来 + 转 md
  images/
  svg_output/ svg_final/ notes/ templates/ exports/ backup/
```

老 `ppt-master/projects/` **不**再有新条目（除 admin 手动 init）。

### 4.6 配额

| 场景 | 行为 |
|---|---|
| `POST /api/jobs` 成功 | 预扣 1 (`100 → 99`) |
| 上传超 50MB | 413 + refund → 100 |
| runner 异常（catastrophic） | 标 failed + refund → 100 |
| `status="failed"`（claude 跑完但没出 pptx） | **不退**（服务已提供） |
| `status="cancelled"`（用户主动 cancel） | **不退** |
| `status="paused"`（等八点确认） | **不退** |
| `status="done"` | 正常扣 |
| 配额 = 0 | 402 quota exhausted |

### 4.7 关键修复的坑

| 坑 | 现象 | 修复 |
|---|---|---|
| `passlib 1.7.4` × `bcrypt 5.0` | `ValueError: password cannot be longer than 72 bytes`（passlib 内部 `detect_wrap_bug` 触发） | 锁 `bcrypt<4.2`（passlib 1.7.4 兼容到 bcrypt 4.1） |
| `from fastapi import FastAPI` 放 lifespan 后 | 装饰器求值时未定义 | 移到文件顶部 |
| `JSONResponse` 缺失 | register/login 报 NameError | 补 import |
| `User` 表为空时 `_enqueue_event` 写 `user_id` 失败 | 老 job 没 user_id → 改 `nullable=True` + run_job 检 user_id | 已加防护 |
| `cleanup_stuck_jobs` 标 "server restart" | 用户不友好 | 改 "server restart interrupted your previous run" |

---

## 5. 已知风险与限制

1. **agent `--dangerously-skip-permissions`**：能 `cat ~/.ssh/`、网络外发等。**直接数据外泄靠 per-user cwd 隔离缓解**（A 看不到 B 的 `data/users/B/`），但 agent 仍能访问系统其他位置。**完整修复 = Phase 2d 之外的硬化：PreToolUse hook 限制 path + 网络**。

2. **claude CLI session 存储是全局**（`~/.claude/<session_id>.jsonl`）——A 的 `session_id` 物理机可被 `claude --resume` 恢复。**HTTP 层 ownership 校验是唯一防线**；一旦 session_id 泄露，攻击者在自己机器上能恢复（成本 = 一次 resume + 一次 export 用的 token）。

3. **单 job 串行**：ppt-master 子脚本（image_gen / confirm_ui / svg_editor）绑死端口 5050/…，多并发会冲突。Phase 3 引入队列时再做 per-user port allocation。

4. **数据迁移**：`migrate_v1_to_v2()` **删老 jobs.db**。MVP 阶段可接受；上线前需改成保留老 jobs + 引导到 "legacy" 用户的方案。

5. **SSE 断线重连**：后端 `last-event-id` 续传靠 DB 回放，没问题；但客户端 EventSource 在网络抖时会自动重连，可能发 2 次请求。Server 的 `from_seq` 解析做了容错。

6. **无 rate limit**：登录端点无 slowapi/abuse 防护。本机演示可接受；公网部署必须加。

7. **JWT 7 天无 refresh**：登出 token 即失效（cookie 清除），但服务端不维护黑名单，过期前一直可用。

---

## 6. 常见操作

### 重置数据库（删所有用户和 job）

```bash
rm -f jobs.db jobs.db-wal jobs.db-shm
# 下次启动 init_db() 会重建空 schema
```

### 重置某个用户的数据

```bash
rm -rf data/users/<user_id>/
# 注意：jobs.db 里仍有该 user 的 job 记录，状态不会变；如要彻底清，先删 job 再删目录
```

### 把用户提到 admin（跳过 ownership 校验）

```bash
sqlite3 jobs.db "UPDATE users SET role='admin' WHERE email='you@x.com';"
```

### 看 agent 在跑什么

```bash
# 实时事件（带 SSE）
curl -b /tmp/a.jar -N http://127.0.0.1:8765/api/jobs/<job_id>/events

# 事后查 DB
sqlite3 jobs.db "SELECT seq, type, substr(payload,1,200) FROM events WHERE job_id='<job_id>' ORDER BY seq;"
```

### 改上传大小限制

`backend/api/routes/jobs.py` 顶部：
```python
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_SINGLE_FILE_BYTES = 25 * 1024 * 1024
```

---

## 7. 验证回归

```bash
# 1) server 启动 + 健康
curl http://127.0.0.1:8765/api/health
# → {"ok":true,"active_job":false}

# 2) Phase 1 核心未回归
.venv/bin/python backend/scripts/smoke.py "4 页 Python 入门"
# → job 创建 → agent 跑 init + import-sources → 30s 后 cancel
# 验证：data/users/<smoke_uid>/projects/<job_id>/<name>_<fmt>_<date>/sources/ 有内容

# 3) 多用户隔离（详 §4.3）

# 4) 文件上传 + agent 引用（详 §4.4）
```

**Done 判据**：
- ✅ A、B 互相不可见对方 job（403 隔离）
- ✅ A 上传 PDF → agent prompt 包含绝对路径 → `sources/` 里有 PDF + .md
- ✅ 项目落到 `data/users/<uid>/projects/<job_id>/...`，`ppt-master/projects/` 不再新加
- ✅ 配额预扣 + 失败/cancel 区分
- ✅ Phase 1 `_smoke.py` 端到端通过
