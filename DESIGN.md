# PPT 在线生成工具 — 设计摘要

> 基于开源 [ppt-master](https://github.com/hugohe3/ppt-master) + Claude Code 的在线 PPT 生成工具。  
> **完整文档** → [`Docs/README.md`](Docs/README.md)

---

## 0. 最关键的认知

**ppt-master 不是一个程序，而是一个「工作流剧本」（skill）。** 它本身没有 main 函数、没有 HTTP 接口——它是一份 `SKILL.md` 流程文档 + 一堆 Python 脚本，**必须由一个具备工具调用能力的 AI agent（如 Claude Code）去读懂剧本、按顺序跑脚本、逐页手写 SVG**。

因此「在线生成工具」的本质不是「给 ppt-master 包个网页」，而是：

> **让服务器去扮演那个 AI IDE（Claude Code），由后端驱动 agent 执行剧本。**

本产品**不应该是「一键出片」**，而应该是 **「AI 主导生成 + 人在环路确认 + 逐页调优」** 的协作工具。详见 [Docs/design.md](Docs/design.md#核心认知与产品定位)。

---

## 实现状态总览

| 阶段 | 条目 | 状态 |
|------|------|------|
| **Phase 0** | claude CLI 驱动 ppt-master skill | ✅ [phase0/REPORT.md](phase0/REPORT.md) |
| | 进度回流（stream-json → SSE） | ✅ |
| | 八点确认暂停/恢复 | ✅ |
| **Phase 1 MVP** | FastAPI + React Web UI | ✅ |
| | 上传/输入、进度、下载、历史 | ✅ |
| | 多用户鉴权 + 配额 | ✅（超出原 Phase 1 范围） |
| | Docker 每 job 隔离 | ✅（原 Phase 2 计划） |
| | Admin 管理后台 | ✅ |
| **Phase 2** | OAuth 登录 | ⬜ |
| | 对象存储 S3/MinIO | ⬜ |
| | 八点确认 Web 面板（默认开启） | 🟡 API 有，默认关闭 |
| | 逐页调优 + SVG 批注 | ⬜ |
| | projects/versions 数据模型 | ⬜ |
| **Phase 3** | 真实计费/套餐 | ⬜ |
| | 模型分层用户 UI | ⬜ |
| | 命令白名单 / gVisor | ⬜ |

完整功能对照 → [Docs/product.md](Docs/product.md#功能实现状态)

---

## 架构（当前实现）

```
浏览器 (Vite + React SPA)
    │ HTTPS + SSE
FastAPI (backend.main:app)
    ├── /api/auth, /api/jobs, /api/admin
    ├── asyncio dispatcher + watchdog
    ├── MySQL 8
    └── data/users/<uid>/
         │
         └── docker run --rm ppt-runner:latest
              └── claude CLI → ppt-master skill → exports/*.pptx
```

详细架构图与请求生命周期 → [Docs/architecture.md](Docs/architecture.md#系统架构总览)

### 与原设计的主要差异

| 原设计 | 当前实现 |
|--------|----------|
| Next.js | Vite + React SPA |
| Celery + Redis | asyncio 进程内 dispatcher |
| Claude Agent SDK hooks | claude CLI + stream-json 解析 |
| WebSocket | SSE |
| S3/MinIO | 本地 `data/users/` |

---

## 设计章节索引

| 原章节 | 主题 | 详细文档 | 当前实现备注 |
|--------|------|----------|-------------|
| §1 | 产品定位 | [Docs/design.md](Docs/design.md#核心认知与产品定位) | 一致 |
| §2 | 总体架构 | [Docs/architecture.md](Docs/architecture.md#系统架构总览) | 已更新技术栈 |
| §3 | 运行时 | [Docs/architecture.md](Docs/architecture.md#任务执行流水线) | CLI 路线，非 Agent SDK |
| §4 | 进度回流 | [Docs/architecture.md](Docs/architecture.md#进度事件与阶段映射) | SSE + stages.py |
| §5 | 八点确认 | [Docs/design.md](Docs/design.md#人在环路八点确认) | **默认自动跳过** |
| §6 | 安全沙箱 | [Docs/design.md](Docs/design.md#安全沙箱与多租户隔离) | Docker 隔离已实现 |
| §7 | 数据模型 | [Docs/architecture.md](Docs/architecture.md#数据模型与文件布局) | 简化为 User+Job+Event |
| §8 | 调优 | [Docs/design.md](Docs/design.md#调优与版本管理) | 规划中 |
| §9 | 登录权限 | [Docs/design.md](Docs/design.md#安全沙箱与多租户隔离) | 邮箱密码，无 OAuth |
| §10 | 成本计费 | [Docs/design.md](Docs/design.md#成本与计费) | credits 预扣 |
| §11 | 技术栈 | [Docs/product.md](Docs/product.md#功能实现状态) | 见差异表 |
| §12 | 风险点 | 下方摘要 | 部分已缓解 |
| §13 | 落地路线 | 上方状态表 | Phase 0–1 基本完成 |

---

## 关键风险（摘要）

1. **长会话稳定性** — Executor 单会话逐页生成，10+ 页可能超时/漂移 → 已有 resume + watchdog；ppt-master `resume-execute` 可复用
2. **成本不可控** — 必须有配额 → 已实现 credits 预扣
3. **多租户安全** — 必须隔离 → Docker 每 job + 文件目录隔离；命令白名单待做
4. **版权/署名** — 网络搜图可能需署名 → 产品需告知用户
5. **模型质量** — 非 Opus 质量上限低 → UI 应明示（待完善）

---

## 关键依赖

- **ppt-master**：`ppt-master/skills/ppt-master/SKILL.md`（git submodule）
- **Claude Code CLI**：Docker 容器内 headless 执行
- **验证报告**：[phase0/REPORT.md](phase0/REPORT.md)

---

## 快速链接

- [Docs 文档导航](Docs/README.md)
- [快速开始](README.md)
- [用户指南](Docs/product.md#用户指南)
- [开发指南](Docs/development.md#开发环境搭建)
- [生产部署](Docs/deployment.md#生产环境部署)
