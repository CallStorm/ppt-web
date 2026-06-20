// Theme store — light/dark, persisted in localStorage.
// Boot script in index.html applies persisted theme BEFORE Alpine starts to avoid flash.

export function registerThemeStore(Alpine) {
  Alpine.store('theme', {
    mode: (() => {
      try {
        const t = localStorage.getItem('ppt.theme');
        if (t === 'dark' || t === 'light') return t;
      } catch {}
      return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    })(),

    isDark() { return this.mode === 'dark'; },

    toggle() {
      this.mode = this.isDark() ? 'light' : 'dark';
      this._apply();
    },

    set(mode) {
      this.mode = mode;
      this._apply();
    },

    _apply() {
      const cls = document.documentElement.classList;
      if (this.isDark()) cls.add('dark'); else cls.remove('dark');
      try { localStorage.setItem('ppt.theme', this.mode); } catch {}
    },
  });
}