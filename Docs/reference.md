# 参考

> 最后更新：2026-06-21  
> 相关代码：[`.env.example`](../.env.example)

复制模板：`cp .env.example .env`（启动 MySQL + build runner 镜像见 [README](../README.md)）。

## 环境变量参考

### 数据库

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DB_URL` | 见 `.env.example` | MySQL 8 连接 URL（**必需**） |

格式：

```
mysql+pymysql://<user>:<password>@<host>:3306/<database>?charset=utf8mb4
```

示例（与 README Docker MySQL 一致）：

```
DB_URL=mysql+pymysql://pptweb:pptweb@127.0.0.1:3306/pptweb?charset=utf8mb4
```

⚠️ 库字符集必须是 **utf8mb4**。驱动 `pymysql` 已包含在 `backend/requirements.txt`。

### 鉴权

| 变量 | 默认 | 说明 |
|------|------|------|
| `PPT_WEB_JWT_SECRET` | （空 = 随机 ephemeral） | JWT 签名密钥。生产必设，否则重启丢登录态 |

生成：`openssl rand -hex 32`

### 并发

| 变量 | 默认 | 说明 |
|------|------|------|
| `MAX_CONCURRENT_JOBS` | `3` | 全局最多同时运行的 job 数。超过后 `POST /api/jobs` 返回 409 |

### Docker Runner

| 变量 | 默认 | 说明 |
|------|------|------|
| `DOCKER_RUNNER_IMAGE` | `ppt-runner:latest` | 执行容器镜像 |
| `DOCKER_RUNNER_NETWORK` | `ppt-isolated` | bridge 网络名 |
| `DOCKER_RUNNER_MEMORY` | `4g` | 单 job 内存上限 |
| `DOCKER_RUNNER_CPUS` | `2` | 单 job CPU 份额 |
| `DOCKER_RUNNER_TIMEOUT_S` | `1800` | 单 job 超时（秒） |

### 八点确认

| 变量 | 默认 | 说明 |
|------|------|------|
| `SKIP_EIGHT_CONFIRM_MAX` | `3` | agent 主动暂停时，自动 resume 的最大轮数 |

当前默认不弹确认面板，agent 用推荐默认值继续。详见 [design.md](design.md#人在环路八点确认)。

### 显示

| 变量 | 默认 | 说明 |
|------|------|------|
| `DISPLAY_TIMEZONE` | `Asia/Shanghai` | 后端时间展示时区 |
| `VITE_DISPLAY_TIMEZONE` | （同左） | 前端 build 时覆盖（可选） |

### Admin

| 变量 | 默认 | 说明 |
|------|------|------|
| `PPT_WEB_RESET_ADMIN_PASSWORD` | （未设） | 设为 `true` 强制重置 admin 密码为 `admin` |

首次启动自动创建 admin/admin。生产请登录后立即改密。

### Claude Code（容器环境变量）

以下变量可在 `.env` 或 Admin UI 配置，注入 Docker 容器：

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_AUTH_TOKEN` | Claude API token（推荐） |
| `ANTHROPIC_API_KEY` | 备选 API key |
| `ANTHROPIC_BASE_URL` | 自定义 API 端点 |
| `ANTHROPIC_MODEL` | 默认模型 |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | Sonnet 模型 |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | Opus 模型 |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | Haiku 模型 |
| `HTTP_PROXY` / `HTTPS_PROXY` | 代理 |

Admin UI 的 allowlist 还支持其他 `CLAUDE_*` 变量。Secrets 存储在 `AppConfig.secrets_json`，不写入日志。

### 优先级

1. Admin UI 运行时配置（最高，仅对新 job 生效）
2. `.env` 文件
3. 代码默认值

---

## API 端点摘要

> 完整 OpenAPI：启动服务后访问 `/docs`（Swagger UI）

所有 API 前缀 `/api`。鉴权通过 HTTP-only cookie（JWT）。

### 健康检查

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/health` | 无 | 服务状态 |

### 鉴权 `/api/auth`

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | `/api/auth/register` | 无 | 注册（email + password ≥6） |
| POST | `/api/auth/login` | 无 | 登录，设置 cookie |
| POST | `/api/auth/logout` | 无 | 清除 cookie |
| GET | `/api/auth/me` | 可选 | 当前用户信息 |

### 任务 `/api/jobs`

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | `/api/jobs` | 用户 | 创建任务（multipart: prompt + files + options） |
| GET | `/api/jobs` | 用户 | 列表（limit=50） |
| GET | `/api/jobs/{id}` | 用户/Admin | 任务详情 |
| POST | `/api/jobs/{id}/resume` | 用户/Admin | 恢复 paused 任务（confirm 文本） |
| POST | `/api/jobs/{id}/cancel` | 用户/Admin | 取消任务 |
| DELETE | `/api/jobs/{id}` | 用户/Admin | 删除任务及文件 |
| GET | `/api/jobs/{id}/events` | 用户/Admin | **SSE** 事件流 |
| GET | `/api/jobs/{id}/pptx` | 用户/Admin | 下载 pptx |
| GET | `/api/jobs/{id}/preview` | 用户/Admin | 封面预览图 |

#### 创建任务参数（Form）

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| prompt | string | 必填 | 1–20000 字符 |
| project_name | string | 自动生成 | 最多 64 字符 |
| language | string | `zh` | 语言 |
| scenario | string | `general` | 场景 |
| audience | string | `general` | 受众 |
| tone | string | `professional` | 语气 |
| page_count | int | `5` | 期望页数 |
| files | file[] | — | 上传文件，单文件 ≤25MB，总计 ≤50MB |

#### 错误码

| 状态码 | 含义 |
|--------|------|
| 401 | 未登录 |
| 402 | 配额耗尽 |
| 409 | 并发上限 / 邮箱已注册 |
| 413 | 上传超限 |

### 管理 `/api/admin`

需 `admin` 角色。主要端点：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/overview` | 统计概览 |
| GET | `/api/admin/settings` | 读取运行时配置 |
| PATCH | `/api/admin/settings` | 更新运行时配置 |
| GET | `/api/admin/users` | 用户列表（支持 q/limit/offset） |
| PATCH | `/api/admin/users/{id}` | 修改 role/quota/密码 |
| GET | `/api/admin/jobs` | 全站任务列表 |
| GET | `/api/admin/jobs/{id}` | 任务详情 + 最近事件 |
| POST | `/api/admin/jobs/{id}/cancel` | 取消任务 |
| POST | `/api/admin/jobs/{id}/mark-failed` | 标记失败（可选 refund） |
| POST | `/api/admin/jobs/{id}/refund` | 手动退还 credits |

### SSE 事件格式

```
GET /api/jobs/{id}/events
Accept: text/event-stream
Last-Event-ID: 42    # 可选，断线续传

id: 43
event: stage
data: {"stage": "6 逐页生成 SVG", "file": "svg_output/03_xxx.svg"}
```

事件类型：`stage`、`page`、`text`、`paused`、`pptx`、`error`、`done`。

详见 [architecture.md](architecture.md#进度事件与阶段映射)。

### SPA 静态文件

非 `/api` 路径由 FastAPI 托管 `webui/dist/`，fallback 到 `index.html`（React Router）。
---

## 相关文档

- [README.md](README.md) — 文档导航
- [product.md](product.md) — 产品
- [architecture.md](architecture.md) — 架构
- [design.md](design.md) — 设计（详细；根目录 [DESIGN.md](../DESIGN.md) 为摘要索引）
- [development.md](development.md) — 开发
- [deployment.md](deployment.md) — 部署
- [reference.md](reference.md) — 参考
