# ppt-web

`ppt-web` 是围绕 [ppt-master](https://github.com/) 的 web 化封装项目。ppt-master 是生成 PPT 的核心 agent + 技能系统；本项目把它包成「开箱即用」的服务，分三阶段渐进：

- **phase0** — CLI 壳，调试用（`python phase0/orchestrator.py run --prompt "..."`）
- **phase1** — FastAPI 单页 Web MVP（`/docs` 看 API 文档）
- **phase2** — 鉴权 + 多用户隔离 + multipart 上传

设计文档：[DESIGN.md](./DESIGN.md)。每个 phase 自己的 `REPORT.md` 记实现笔记。

## 快速开始

```bash
# 1. clone（含 submodule）
git clone --recursive <repo-url>
cd ppt-web

# 2. 建虚拟环境 + 装依赖
python3 -m venv .venv
.venv/bin/pip install -r phase1/requirements.txt

# 3. 启动 Web 服务
.venv/bin/uvicorn phase1.server:app --host 127.0.0.1 --port 8765

# 4. 浏览器打开
open http://127.0.0.1:8765/
```

第一次启动会自动跑 DB 迁移（`v1→v2→v3`）。

## 8 点确认开关

新建任务表单里有个 checkbox：**「需要 8 点确认」**。

- **默认关闭**：agent 在 stage 3 的「八点确认」点会自动按推荐方案继续，不弹确认面板
- **勾上**：停在确认点，详情面板会显示「⏸ 需要你的确认」让你回复

全局兜底：环境变量 `SKIP_EIGHT_CONFIRM=true` 强制覆盖（运维侧一键全跳过）。

```bash
# 想让所有 job 都跳过 8 点确认
SKIP_EIGHT_CONFIRM=true .venv/bin/uvicorn phase1.server:app
```

## ppt-master 是 submodule

`ppt-master/` 目录是 git submodule，源码独立版本管理，方便升级不污染本仓。

```bash
# 升级 ppt-master
cd ppt-master
git pull origin main
cd ..
git add ppt-master
git commit -m "chore: bump ppt-master to <version>"
```

本仓的 `.gitmodules` 指向本地 bare 仓 `~/Developer/personal/personal-git/ppt-master.git`。
如要推到 GitHub，把 bare 仓先 push 上去，再把 `.gitmodules` 里的 URL 改成 https URL 提交一次。

> ⚠️ **clone 时一定要带 `--recursive`**，否则 `ppt-master/` 是空目录。

## 目录结构

```
ppt-web/
├── DESIGN.md              # 整体设计稿
├── README.md              # 本文件
├── .gitignore
├── phase0/                # CLI 调试壳
│   ├── orchestrator.py
│   ├── fix_preview_fonts.py
│   └── README.md
├── phase1/                # FastAPI Web MVP
│   ├── server.py          # 入口
│   ├── core.py            # agent 调用 + 八点确认逻辑
│   ├── auth.py / models.py / db.py / paths.py
│   ├── static/            # 前端
│   └── _smoke.py          # 不接 HTTP 的烟雾测试
├── phase2/                # 鉴权 + 多用户（部分就位）
│   └── REPORT.md
├── data/                  # 运行时用户数据（gitignored）
└── ppt-master/            # ← git submodule
```

## 跑测试

```bash
# 端到端 smoke（要 claude CLI 在 PATH，会烧 token）
.venv/bin/python phase1/_smoke.py "写一份 4 页 Python 简介 PPT"
```
