/** 关键词触发的轻量 AI 提示气泡（无 LLM 调用，确定性）。 */
export const AI_HINTS: { keywords: string[]; text: string }[] = [
  {
    keywords: ['商业', 'bp', '商业计划', 'pitch'],
    text: '💡 检测到商业计划书，建议补充『市场痛点』和『盈利模式』章节',
  },
  {
    keywords: ['产品', 'product', '发布', 'launch'],
    text: '💡 产品发布？建议突出『核心价值』和『目标用户』',
  },
  {
    keywords: ['技术', '架构', 'architecture', '系统设计'],
    text: '💡 技术方案？建议加入『架构图』和『对比基准』',
  },
  {
    keywords: ['数据', '报告', 'data', 'report'],
    text: '💡 数据报告？『关键发现』和『行动建议』会更抓眼球',
  },
  {
    keywords: ['教学', '培训', '教程', 'training', 'tutorial'],
    text: '💡 教学类内容？『学习目标』和『小结』能帮学员抓住重点',
  },
]

/** 返回第一条命中关键词的提示文案；无命中返回 null。 */
export function pickHint(text: string): string | null {
  const t = text.toLowerCase()
  for (const h of AI_HINTS) {
    if (h.keywords.some((k) => t.includes(k.toLowerCase()))) return h.text
  }
  return null
}
