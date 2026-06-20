// Templates view — 模板库列表（mock 数据）+ 编辑器。

import { MOCK_TEMPLATES, extractVariables, highlightPrompt } from '../mock-templates.js';
import { notifySuccess, notifyError } from '../toast.js';

export function renderTemplates() {
  window.Alpine.data('templatesView', () => ({
    templates: MOCK_TEMPLATES,

    useTemplate(id) {
      // 跳到新建任务页，并预填
      window.location.hash = '#/new';
      // 通知 new-job 视图选中这个 template（通过 Alpine store）
      window.dispatchEvent(new CustomEvent('use-template', { detail: { id } }));
    },

    editTemplate(id) {
      window.location.hash = `#/templates/${id}`;
    },
  }));

  // 模板编辑器 view（用于 #/templates/{id}）
  window.Alpine.data('templateEditorView', () => ({
    template: null,
    prompt: '',
    variables: {},
    variableValues: {},

    init() {
      const id = (window.location.hash.match(/^#?\/templates\/(\S+)$/) || [])[1];
      this.template = MOCK_TEMPLATES.find(t => t.id === id) || null;
      if (this.template) {
        this.prompt = this.template.prompt;
        this.variables = { ...this.template.variables };
        for (const [k, def] of Object.entries(this.variables)) {
          this.variableValues[k] = def.default ?? '';
        }
      }
    },

    onPromptInput() {
      // 自动从 prompt 提取新变量
      const found = extractVariables(this.prompt);
      const next = {};
      for (const name of found) {
        next[name] = this.variables[name] || { type: 'text', label: name };
      }
      this.variables = next;
    },

    onVariableChange(name, val) {
      this.variableValues = { ...this.variableValues, [name]: val };
    },

    addVariable() {
      // 让用户输入新变量名
      const name = prompt('变量名（仅字母数字下划线）');
      if (!name || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return;
      this.variables = {
        ...this.variables,
        [name]: { type: 'text', label: name, default: '' },
      };
      this.variableValues = { ...this.variableValues, [name]: '' };
      // 自动加 {{name}} 到 prompt 末尾
      if (!this.prompt.endsWith(' ')) this.prompt += ' ';
      this.prompt += `{{${name}}}`;
    },

    removeVariable(name) {
      const next = { ...this.variables };
      delete next[name];
      this.variables = next;
      const nextVals = { ...this.variableValues };
      delete nextVals[name];
      this.variableValues = nextVals;
      // 从 prompt 移除 {{name}}
      this.prompt = this.prompt.replace(new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`, 'g'), '');
    },

    get highlighted() {
      return highlightPrompt(this.prompt);
    },

    save() {
      // Phase 1 stub — 提示用户这只是 mock
      notifySuccess('(Mock) 已保存。Phase 2 接后端 API 后才真正持久化。');
    },

    cancel() {
      window.location.hash = '#/templates';
    },
  }));
}