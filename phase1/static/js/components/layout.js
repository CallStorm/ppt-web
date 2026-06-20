// Layout shell helpers — header / sidebar / main outlet 状态。

export function registerLayoutData() {
  window.Alpine.data('layout', () => ({
    toggleSidebar() {
      this.sidebarOpen = !this.sidebarOpen;
    },
    closeSidebar() {
      this.sidebarOpen = false;
    },
    go(hash) {
      window.location.hash = hash;
    },
    async logout() {
      await window.Alpine.store('auth').logout();
      window.location.hash = '';
      window.location.reload();
    },
    toggleTheme() {
      window.Alpine.store('theme').toggle();
    },
  }));
}