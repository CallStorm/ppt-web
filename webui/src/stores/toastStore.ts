import { create } from 'zustand'

export interface Toast {
  id: number
  message: string
  kind: 'info' | 'success' | 'error'
}

interface ToastState {
  toasts: Toast[]
  show: (message: string, kind?: Toast['kind'], durationMs?: number) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  show: (message, kind = 'info', durationMs = 3500) => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, durationMs)
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export const notifySuccess = (msg: string) => useToastStore.getState().show(msg, 'success')
export const notifyError = (msg: string) => useToastStore.getState().show(msg, 'error', 5000)
export const notifyInfo = (msg: string) => useToastStore.getState().show(msg, 'info')
