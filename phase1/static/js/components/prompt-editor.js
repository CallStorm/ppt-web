// Prompt editor — 状态由外部管理（newJob.templateEditor 等）。
// 这里只暴露 reactive 视图 helpers：高亮 / 提取变量名 / 单变量 change 回调。
//
// 用法：
//   外部 (newJob) 持有 prompt + variableValues + definitions
//   promptEditor() 只是为了暴露 helpers（extractVars, highlight）

import { extractVariables, highlightPrompt } from '../mock-templates.js';

export function registerPromptEditor() {
  window.Alpine.data('promptEditor', () => ({
    /** 从 prompt 字符串里提取所有 {{var}} 名 */
    extractVars(prompt) { return extractVariables(prompt || ''); },
    /** 返回高亮 HTML */
    highlight(prompt) { return highlightPrompt(prompt || ''); },
  }));
}