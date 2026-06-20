// Variable input — 根据 definition.type 渲染不同的表单控件。
// 接收单个变量定义 + 当前值 + change callback。

export function registerVariableInput() {
  window.Alpine.data('variableInput', (name, def, value, onChange) => ({
    name,
    def,
    value: value ?? def.default ?? '',
    onChange,

    init() {
      // 初始化时如果 value 为空，用 default
      if ((this.value === '' || this.value == null) && this.def.default != null) {
        this.value = this.def.default;
        this._emit();
      }
    },

    onInput() { this._emit(); },
    onSelectChange(ev) { this.value = ev.target.value; this._emit(); },

    _emit() {
      if (this.onChange) this.onChange(this.name, this.value);
    },
  }));
}