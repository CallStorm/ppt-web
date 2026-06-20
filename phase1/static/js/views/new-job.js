// New job view — 模板选择 + prompt 编辑 + 变量面板 + 文件拖拽 + 实时预览 + 提交。
//
// 状态全部由本组件管，prompt 变化时自动同步变量定义。

import { api } from '../api.js';
import { MOCK_TEMPLATES, fillPrompt, extractVariables } from '../mock-templates.js';
import { notifySuccess, notifyError } from '../toast.js';

export function renderNewJob() {
  window.Alpine.data('newJobView', () => ({
    // ── state ──
    templates: MOCK_TEMPLATES,
    selectedTemplateId: null,
    projectName: '',
    prompt: '',
    variableDefs: {},          // { name: { type, label, default, required, options } }
    variableValues: {},        // { name: '...' }
    submitting: false,

    // ── template 选择 ──
    selectTemplate(id) {
      this.selectedTemplateId = id;
      const t = this.templates.find(x => x.id === id);
      if (!t) return;
      this.prompt = t.prompt;
      this.variableDefs = { ...t.variables };
      this.variableValues = {};
      for (const [k, def] of Object.entries(t.variables)) {
        this.variableValues[k] = def.default ?? '';
      }
    },

    get selectedTemplate() {
      return this.templates.find(t => t.id === this.selectedTemplateId);
    },

    // ── prompt 变化 ──
    onPromptInput() {
      // 用户改了 prompt：自动从 prompt 提取变量
      const found = extractVariables(this.prompt);
      const next = {};
      for (const name of found) {
        next[name] = this.variableDefs[name] || { type: 'text', label: name };
      }
      this.variableDefs = next;
      // 保留现有值；新变量用 default；丢弃已删除的值
      const nextValues = {};
      for (const name of found) {
        nextValues[name] = this.variableValues[name] ?? next[name].default ?? '';
      }
      this.variableValues = nextValues;
      // 如果 prompt 跟 selected template 不一致，清掉选择
      if (this.selectedTemplate && this.prompt !== this.selectedTemplate.prompt) {
        this.selectedTemplateId = null;
      }
    },

    onVariableChange(name, val) {
      this.variableValues = { ...this.variableValues, [name]: val };
    },

    // ── 预览 ──
    get filledPrompt() {
      if (!this.prompt) return '(空 prompt)';
      const filled = fillPrompt(this.prompt, this.variableValues);
      const missing = Object.entries(this.variableDefs)
        .filter(([_, def]) => def.required)
        .filter(([k]) => !this.variableValues[k])
        .map(([k]) => k);
      if (missing.length) {
        return filled + `\n\n[未填写必填变量: ${missing.join(', ')}]`;
      }
      return filled;
    },

    get variableNames() {
      return Object.keys(this.variableDefs);
    },

    get variableNamesHighlighted() {
      return this.variableNames;
    },

    get canSubmit() {
      if (this.submitting) return false;
      if (!this.prompt.trim()) return false;
      if (window.Alpine.store('auth').quota() <= 0) return false;
      // 所有 required 变量都得有值
      return Object.entries(this.variableDefs)
        .filter(([_, def]) => def.required)
        .every(([k]) => {
          const v = this.variableValues[k];
          return v !== undefined && v !== null && String(v).trim() !== '';
        });
    },

    // ── submit ──
    async submit() {
      if (!this.canSubmit) return;
      this.submitting = true;
      try {
        const fd = new FormData();
        fd.append('prompt', this.filledPrompt);
        if (this.projectName.trim()) fd.append('project_name', this.projectName.trim());
        // 收集文件（从 dropzone ref）
        const dropzone = this.$refs.files;
        if (dropzone && dropzone.files) {
          for (const { file } of dropzone.files) {
            fd.append('files', file, file.name);
          }
        }
        const job = await api('POST', '/api/jobs', fd);
        notifySuccess('任务已创建，排队中…');
        window.Alpine.store('jobs').upsert(job);
        window.location.hash = `#/jobs/${job.id}`;
        // 清空 form
        this.projectName = '';
        this.prompt = '';
        this.variableDefs = {};
        this.variableValues = {};
        this.selectedTemplateId = null;
      } catch (e) {
        notifyError('创建失败: ' + e.message);
      } finally {
        this.submitting = false;
      }
    },

    cancel() {
      window.location.hash = '#/';
    },
  }));
}