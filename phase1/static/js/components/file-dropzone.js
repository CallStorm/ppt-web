// File dropzone — 拖拽 + 点击选择，列出文件 chips。
// 不立即上传，仅在 submit 时把文件 append 到 FormData。

import { fmtBytes } from '../format.js';

export function registerFileDropzone() {
  window.Alpine.data('fileDropzone', () => ({
    files: [],          // [{ file: File, name, size }]
    dragging: false,

    openPicker() { this.$refs.input.click(); },

    addFiles(list) {
      for (const f of list || []) {
        if (!f?.name) continue;
        this.files.push({ file: f, name: f.name, size: f.size });
      }
    },

    onPick(ev) {
      this.addFiles(ev.target.files);
      ev.target.value = '';  // 允许重复选择同一文件
    },

    onDrop(ev) {
      this.dragging = false;
      this.addFiles(ev.dataTransfer.files);
    },

    remove(idx) {
      this.files.splice(idx, 1);
    },

    /** submit 时把 file 列表转成 FormData */
    toFormData() {
      const fd = new FormData();
      for (const { file } of this.files) fd.append('files', file, file.name);
      return fd;
    },

    fmtBytes,
  }));
}