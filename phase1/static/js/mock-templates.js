// Mock 模板数据 — Phase 1 前端 stub，Phase 2 接后端 API。
// 每个模板：id, name, description, prompt (含 {{var}} 占位符), variables 字典
//
// variable schema:
//   { type: 'text'|'number'|'textarea'|'select',
//     label?: string,           // 显示名（默认用 name）
//     default?: any,
//     options?: string[],       // select 用
//     required?: bool,
//     placeholder?: string }
//
// Phase 2 后端：Template 模型会有 id/user_id/name/body/variables JSON/is_public/category
// Phase 1：前端用这套 mock 数据完整跑通模板 UI 流程。

export const MOCK_TEMPLATES = [
  {
    id: 't1',
    name: '技术分享',
    description: '面向特定受众的技术主题分享 PPT',
    prompt: '请为「{{topic}}」写一份 {{pages}} 页的技术分享 PPT，目标受众是 {{audience}}。\n\n要求：\n- 风格：{{style}}\n- 重点突出 {{focus}}\n- 最后给出 3 个延伸阅读建议',
    variables: {
      topic:  { type: 'text',     label: '主题',       placeholder: '例：Kubernetes 网络模型', required: true },
      pages:  { type: 'number',   label: '页数',       default: 8, required: true },
      audience: { type: 'select', label: '受众',       options: ['初级开发者', '中级开发者', '高级开发者', '架构师', '管理层'], default: '中级开发者', required: true },
      style:  { type: 'select',   label: '风格',       options: ['商务简洁', '科技感', '温馨', '学术风'], default: '科技感' },
      focus:  { type: 'text',     label: '重点',       placeholder: '例：CNI 插件机制', required: true },
    },
  },
  {
    id: 't2',
    name: '产品介绍',
    description: '对外产品介绍 PPT',
    prompt: '为产品「{{product}}」制作一份对外介绍 PPT。\n\n- 目标客户：{{customer}}\n- 核心卖点：{{features}}\n- 页数：{{pages}}\n- 风格：商务专业，配色用品牌色\n\n最后要有一个明确的 CTA（行动号召）。',
    variables: {
      product:  { type: 'text',     label: '产品名',   required: true },
      customer: { type: 'text',     label: '目标客户', placeholder: '例：企业 CTO、跨境电商', required: true },
      features: { type: 'textarea', label: '核心卖点', placeholder: '每行一个', required: true },
      pages:    { type: 'number',   label: '页数',     default: 8 },
    },
  },
  {
    id: 't3',
    name: '学术答辩',
    description: '本科/研究生毕业答辩 PPT',
    prompt: '答辩 PPT：\n- 论文题目：{{thesis_title}}\n- 研究方向：{{field}}\n- 关键贡献：{{contributions}}\n- 答辩时长：{{duration}} 分钟\n- 页数：{{pages}}',
    variables: {
      thesis_title: { type: 'text',     label: '论文题目',   required: true },
      field:         { type: 'text',     label: '研究方向',   placeholder: '例：分布式系统' },
      contributions: { type: 'textarea', label: '关键贡献',   required: true },
      duration:      { type: 'number',   label: '答辩时长',   default: 20 },
      pages:         { type: 'number',   label: '页数',       default: 18 },
    },
  },
  {
    id: 't4',
    name: '空白模板',
    description: '从零开始，不带任何变量',
    prompt: '',
    variables: {},
  },
];

/** 提取 prompt 里的所有 {{var}} 名字 */
export function extractVariables(prompt) {
  const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
  const set = new Set();
  let m;
  while ((m = re.exec(prompt)) !== null) set.add(m[1]);
  return Array.from(set);
}

/** 用 values 替换 {{var}} */
export function fillPrompt(prompt, values) {
  return prompt.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, name) => {
    const v = values[name];
    return (v === undefined || v === null || v === '') ? `{{${name}}}` : String(v);
  });
}

/** 高亮 prompt 为 HTML（<span class="token-var">{{name}}</span>） */
export function highlightPrompt(prompt) {
  // escape first
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc(prompt).replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g,
    (_, name) => `<span class="token-punct">{{</span><span class="token-var">${name}</span><span class="token-punct">}}</span>`);
}