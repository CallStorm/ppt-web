# 创建任务表单交互重构设计

日期：2026-06-23
范围：`webui` 创建任务页 + `backend` AI 接口

## 背景

当前创建任务表单（`webui/src/pages/NewJobPage.tsx`）存在三个交互问题：

1. **附件素材与推荐脱节**：上传文档后，章节大纲、重点强调、推荐设置等 AI 推荐完全不会参考文档内容。四个 AI 按钮（优化描述 / 重新推荐 / 生成大纲 / 推荐风格）向后端只发送 `core_topic` 文本，文件从不参与推荐。
2. **推荐是逐字段、非全局**：4 个分散按钮各填各的字段，用户要点多次。`优化描述` 虽然顺带填了 3 项，但其余按钮各自孤立，不符合「点一次填全部」的预期。
3. **无主题/文档输入路径区分**：表单只有单一的 `core_topic` 文本框 + 可选附件，没有「以主题为种子」与「以文档为种子」两条不同路径的概念。

## 目标

- 表单顶部提供「主题输入 / 文档输入」互斥切换，两条路径走不同交互。
- 用一个全局「智能填充」按钮替代 4 个逐字段按钮，一次点击填充全部可推荐字段；文档模式下基于文档内容填充（含自动提取主题）。
- 智能填充为可选辅助，不强制；提交流程与后端契约尽量保持不变。

## 非目标

- 不做图片/扫描件的 OCR（仓库内无任何 OCR 能力，属全新工作）。
- 不改造 ppt-master 本身的文档解析能力，只复用其已有 `source_to_md` 脚本所依赖的解析库。
- 不改动任务运行时（dispatcher / runner / docker）流程。

## 方案概览（选定：Approach A）

新增一个合并接口 `POST /api/app/llm/auto-fill`，单次 LLM 调用返回全部可推荐字段。文档模式下后端在进程内解析文档文本喂给该次调用。前端移除 4 个逐字段按钮，改为一个全局「智能填充」按钮。

### 选型理由

- 唯一能真正实现「一次点击全局填充」的方案。
- 单次 LLM 调用，成本低、延迟低，文档上下文在所有字段间共享。
- 文档解析为「集成」而非「全新」：ppt-master 的 `source_to_md/*.py` 已覆盖 PDF/DOCX/PPTX/XLSX/MD/HTML/TXT，所依赖的库（PyMuPDF / mammoth / openpyxl / python-pptx / beautifulsoup4 / markdownify）成熟可用，仅需加入 `backend/requirements.txt` 并在接口中调用。

被否决方案：
- **B（客户端串联 3 个旧接口）**：3 次 LLM 调用，成本与延迟 3 倍，串行且脆弱，文档上下文仍需逐个塞入。
- **C（保留逐字段按钮 + 全部推荐宏）**：本质是旧按钮的宏，未真正满足「单一全局按钮」，且保留了要去除的杂乱。

## 详细设计

### 1. 表单结构与模式切换（前端）

在 ② 内容输入 顶部增加互斥分段切换：

```
② 内容输入
  [ 主题输入 ][ 文档输入 ]      ← 分段切换

  ─── 主题模式 ───              ─── 文档模式 ───
  核心主题 *  (textarea,必填)    上传文档 *  (FileUploadZone,必填)
                                 核心主题 *  (textarea,必填,智能填充自动写入)
```

- **主题模式**（默认）：`core_topic` 为必填种子，不显示上传区。
- **文档模式**：上传区为必填种子，`core_topic` 仍保留且必填——由智能填充自动提取写入，用户也可手动编辑。
- `core_topic` 在两种模式下都必填 → 后端 `prompt` 非空契约不变，风险最低。
- 模式切换不清空已填内容（主题文本、已上传文件、已填充字段均保留），仅改变「哪个是必填种子」。
- 移除 4 个逐字段 AI 按钮（优化描述 / 重新推荐 / 生成大纲 / 推荐风格）及其处理函数。

状态新增：`mode: 'topic' | 'document'`。`mode` 不进入 `JobOptions`，不影响后端。

`canSubmit`：
```
mode==='topic'  ? coreTopic.trim()
                : (files.length > 0 && coreTopic.trim())
```
再叠加 `quota() > 0` 与 `!submitting`。

### 2. 全局「智能填充」按钮与新接口

**前端按钮：**
- 位置：② 内容输入 顶部、模式切换下方。
- 启用条件：主题模式 → `core_topic` 非空；文档模式 → 至少 1 个文件已上传。
- 加载态：点击后显示「智能填充中…」并禁用，期间不可重复点击。
- 填充策略：**覆盖式**。一次写入大纲、重点、推荐设置、风格。主题模式不动 `core_topic`（用户自填）；文档模式写入自动提取的 `core_topic`。已填内容被覆盖。填充后用户仍可手改任何字段。

**请求：**
- 主题模式：`POST /api/app/llm/auto-fill`，JSON `{ mode:'topic', core_topic }`。
- 文档模式：同接口，`multipart/form-data`，携带文件 + `{ mode:'document' }`。

**响应（单次 LLM 调用，统一载荷）：**
```json
{
  "core_topic": "...",            // 仅文档模式返回（自动提取）；主题模式省略
  "key_points": ["...", "..."],
  "suggested_options": { "language": "...", "scenario": "...", "audience": "...", "tone": "...", "page_count": 10 },
  "outline": ["第一章 ...", "..."],
  "style": { "visual_style": "...", "color_mode": "...", "brand_hex": "...", "industry": "...", "image_strategy": "..." }
}
```

前端一次性应用全部字段：复用现有 `applySuggestedOptions`，新增对 `outline` / `key_points` / `style` / `core_topic`（文档模式）的应用逻辑。完成后 toast 显示所用模型。

**后端新接口 `POST /api/app/llm/auto-fill`**（`backend/api/routes/app_llm.py` + `backend/app/llm.py`）：
- 接收 JSON 或 multipart（FastAPI：用 `Form` + `UploadFile` 处理；或拆两个路由复用同一核心函数）。
- 文档模式：调用新 helper `extract_document_text(files)`，复用 ppt-master `source_to_md` 依赖的库把 PDF/DOCX/PPTX/XLSX/MD/HTML/TXT 转 markdown，拼接后截断到 token 预算（约 30k 字符）。
- 构造单一合并系统提示 `SYSTEM_AUTOFILL_PROMPT`，指示模型以上述 JSON 结构返回全部字段；种子为主题文本或提取的文档 markdown。
- 复用现有 `chat_json()` + `get_default_model()` + 枚举校验（`_pick_enum`/`_pick_int`），非法枚举逐字段静默丢弃并回退原值。
- 解析在 backend 进程内同步执行，通过 `asyncio.to_thread` 包裹避免阻塞事件循环。

**依赖：** 向 `backend/requirements.txt` 新增 `PyMuPDF`、`mammoth`、`markdownify`、`openpyxl`、`python-pptx`、`beautifulsoup4`（当前一个都没有）。

**旧接口处理：** `optimize-prompt` / `generate-outline` / `suggest-style` 暂时保留（表单不再使用），本次不删，降低 diff 与风险。

### 3. 交互细节与异常处理

- **未配置默认模型 / 无 API Key**：沿用现有逻辑，弹 toast「没有配置默认模型，请到管理后台 → 应用设置 启用并设默认」，不发请求。
- **文档无法提取文本**（图片/扫描件，或解析失败）：接口返回错误，前端弹 toast「无法从该文件提取文本（图片/扫描件暂不支持），请改用文本类文档，或在主题模式下手动填写。」不填充任何字段。
- **LLM 返回非法枚举**：后端逐字段静默丢弃、回退原值，前端不会收到非法值。
- **网络/上游错误**：沿用现有 502 提示。
- **智能填充与提交的关系**：智能填充为可选辅助，非必经步骤；用户可完全不点，手动填完直接提交。

### 4. 提交流程

`submit` 基本不变：仍把 `core_topic` 作为 `prompt` 发送，文件作为 multipart，`JobOptions` 契约不变。唯一新增表单状态 `mode` 不进 `JobOptions`、不影响后端。

## 受影响文件

前端：
- `webui/src/pages/NewJobPage.tsx` — 加模式切换、全局按钮，移除 4 个逐字段按钮与处理函数，调整 `canSubmit`。
- `webui/src/components/jobs/AiOptimizeButton.tsx` — 新增 `auto-fill` endpoint 选项（或新建一个支持 multipart 的按钮组件）。

后端：
- `backend/api/routes/app_llm.py` — 新增 `auto-fill` 路由。
- `backend/app/llm.py` — 新增 `auto_fill()` 核心函数、`SYSTEM_AUTOFILL_PROMPT`、`extract_document_text()` helper、枚举校验复用。
- `backend/requirements.txt` — 新增解析库依赖。

文档解析复用（不改动）：
- `ppt-master/skills/ppt-master/scripts/source_to_md/*.py` — 仅参考其依赖与解析方式，不修改。

## 风险与限制

- **图片/扫描件无 OCR**：明确不支持，遇此情况给出明确提示并引导用户改用文本类文档或主题模式。
- **后端新增解析库依赖**：需确认部署环境能安装（PyMuPDF 等含原生扩展）；若后端运行环境受限，备选方案是 shell out 到 ppt-master 脚本（subprocess）而非在进程内 import。
- **文档 token 预算**：超长文档截断后可能丢失细节，影响推荐质量；以约 30k 字符为初值，后续可调。
- **模式切换不清空**：用户在两模式间反复切换可能产生「文件 + 手填主题」混合状态，属预期行为（两者都必填即可提交）。

## 测试要点

- 主题模式：智能填充一次填入大纲/重点/设置/风格，`core_topic` 不变。
- 文档模式：上传 PDF/DOCX，智能填充写入 `core_topic`（提取）+ 全部字段。
- 文档模式上传图片：弹明确错误 toast，不崩溃、不部分填充。
- 未配置模型：弹 toast，不发请求。
- 模式切换：切换不清空已填内容；`canSubmit` 随模式正确变化。
- 智能填充后手动改字段再提交，提交载荷正确。
- 未点智能填充直接手动填写并提交，正常创建。
