# ppt-web 文档

> 最后更新：2026-06-21

ppt-web 是基于 [ppt-master](https://github.com/hugohe3/ppt-master) 的在线 PPT 生成服务。

> **启动前**：需 Docker 启动 MySQL + 构建 ppt-runner 镜像（见 [README](../README.md) 快速开始）。

## 文档列表

| 文档 | 内容 |
|------|------|
| [product.md](product.md) | 产品概览、功能实现状态、用户指南 |
| [architecture.md](architecture.md) | 系统架构、执行流水线、SSE 事件、数据模型 |
| [design.md](design.md) | 设计原则、八点确认、安全沙箱、调优、成本（详细） |
| [development.md](development.md) | 开发环境、目录结构、前后端指南、Phase 0 CLI |
| [deployment.md](deployment.md) | 本地开发模式、生产部署、Docker Runner |
| [reference.md](reference.md) | 环境变量、API 端点摘要 |

**快速入口**

| 我想… | 去看 |
|--------|------|
| 了解产品 | [product.md](product.md#产品概览) |
| 看功能实现状态 | [product.md](product.md#功能实现状态) |
| 使用 Web 界面 | [product.md](product.md#用户指南) |
| 理解系统架构 | [architecture.md](architecture.md#系统架构总览) |
| 本地开发 | [development.md](development.md#开发环境搭建) |
| 生产部署 | [deployment.md](deployment.md#生产环境部署) |
| 设计原则 | [design.md](design.md#核心认知与产品定位) |
| 环境变量 | [reference.md](reference.md#环境变量参考) |
| API 摘要 | [reference.md](reference.md#api-端点摘要) |

## 相关文件

| 文件 | 说明 |
|------|------|
| [../README.md](../README.md) | 5 分钟快速开始 |
| [../DESIGN.md](../DESIGN.md) | 设计摘要与实现状态索引（非详细设计） |
| [../phase0/REPORT.md](../phase0/REPORT.md) | Phase 0 技术验证报告 |

> 根目录 `DESIGN.md` 是设计摘要；详细设计内容在 [design.md](design.md)。
