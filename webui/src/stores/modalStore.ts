import { create } from 'zustand'

interface ModalConfig {
  title: string
  body: string
  confirmText: string
  cancelText: string
  onConfirm: () => void
  onCancel: () => void
}

interface ModalState {
  open: boolean
  config: ModalConfig | null
  openWith: (config: ModalConfig) => void
  close: () => void
}

export const useModalStore = create<ModalState>((set) => ({
  open: false,
  config: null,

  openWith: (config) => set({ open: true, config }),
  close: () => set({ open: false, config: null }),
}))

export function confirmDialog(opts: {
  title: string
  body: string
  confirmText?: string
  cancelText?: string
}): Promise<boolean> {
  return new Promise((resolve) => {
    useModalStore.getState().openWith({
      title: opts.title,
      body: opts.body,
      confirmText: opts.confirmText ?? '确定',
      cancelText: opts.cancelText ?? '取消',
      onConfirm: () => {
        useModalStore.getState().close()
        resolve(true)
      },
      onCancel: () => {
        useModalStore.getState().close()
        resolve(false)
      },
    })
  })
}
