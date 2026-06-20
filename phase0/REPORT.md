# Phase 0 验证报告

> 验证 DESIGN.md 中风险最高的技术假设。结论：**全部通过，技术路径成立。**

## 验证的三件事 + 结果

### 1. 服务器能驱动 ppt-master skill ✅
用 `claude -p` headless，`cwd=ppt-master/`，初始 prompt 指示读取 `SKILL.md` 并执行。
agent 实际执行了完整真实流水线：
`读 SKILL.md → project_manager.py init → 加载 Strategist → 收集设计上下文(visual-styles/charts/icons) → 写 design_spec.md + spec_lock.md → 加载 Executor → 逐页手写 4 张 SVG → 质检 → 后处理 → svg_to_pptx 导出`。

### 2. 进度回流 ✅
`--output-format stream-json --verbose`，解析 `type:assistant` 的 `tool_use` 块，按命令/文件路径映射阶段。实测映射命中：
- `[2 建项目]` ← `project_manager.py init`
- `[3 策略规划]` ← 写 `design_spec.md` / `spec_lock.md`
- `[6 逐页生成 SVG]` ← 写 `svg_output/0N_*.svg`（每页一条，实时推送）

> 已知小瑕疵（不影响验证）：Executor 每页前重读 `spec_lock.md`（SKILL 规则8）被分类器误标成阶段3。Phase 1 区分 Read/Write 即可消除。

### 3. 人在环路暂停/恢复 ✅
- **暂停**：agent 在「八点确认」BLOCKING 处 `end_turn` 停下，列出完整 8 项推荐（画布/页数/关键信息/模式+风格/配色/图标/字体/图片）。编排器检测无 pptx → 判定 paused → 落盘 `session_id` 退出。
- **恢复**：`resume --confirm "..."` 用 `--resume <session_id>` 注入人类确认继续。
- **改 spec 验证**：resume 时把页数从推荐的 8 改成 4，agent 接受并按 4 页生成 —— 证明 resume 不仅能"确认"，还能"修改"，满足 Web 端更强需求。
- 关键约束生效：聊天确认（未启动会挂死的 `confirm_ui`）、跳过外部 API（无图片，图标+色块承担视觉）。

## 产物

```
ppt-master/projects/phase0_demo_ppt169_20260619/
  ├ design_spec.md, spec_lock.md
  ├ svg_output/01_封面.svg … 04_核心优势.svg   (4 页)
  └ exports/phase0_demo_20260619_185714.pptx   (58K, 有效 OOXML)
```

pptx 校验：4 页、16:9（12192000×6858000 EMU）、每页 7-8 个原生可编辑 DrawingML 形状。✅ 真 PPT，非图片。

## 成本

| 阶段 | 花费 |
|---|---|
| Strategist + 八点确认（run） | $0.51 |
| design_spec + 4 页 SVG + 导出（resume） | $2.38 |
| **合计（4 页，glm-5.2）** | **$2.89** |

> 模型为本环境默认 glm-5.2（非官方推荐的 Claude Opus）。glm-5.2 验证「流程能跑通」；质量上限需换 Opus。按此推算，8-10 页 Opus deck 单次约 $5-20，与 DESIGN.md 第 10 节预估一致。

## 发现的问题（已修 / 待办）

- **[已修] done-detection 误报**：`project_manager init` 把目录命名为 `<name>_<format>_<date>`，编排器原按 `<name>` 找找错目录，导致 pptx 已生成却报 paused。已加 `resolve_project_dir()` 按前缀 glob 解析真实目录。
- **[待办] 分类器 Read/Write 区分**：spec_lock 重读误标阶段3（见上）。
- **[待办] live preview 缺 flask**：`svg_editor/server.py` 因环境缺 flask 未启动，仅影响浏览器实时预览，不影响生成/导出。Phase 1 补 `pip install flask`。
- **[待办] superpowers 插件噪声**：SessionStart hook 注入大段 superpowers 上下文，增加每会话固定 token 开销且与"读 SKILL.md"指令潜在冲突。生产环境考虑禁用该插件或用独立 settings。

## 结论

**Phase 0 技术去风险完成。** "服务器扮演 Claude Code 驱动 ppt-master + 进度回流 + 八点确认暂停/恢复" 这条核心路径被真实跑通并产出有效 pptx。可进入 Phase 1（FastAPI + 前端 MVP）。
