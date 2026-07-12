import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type {
  ChatDraft,
  Conversation,
  ConversationListResponse,
  ChatMessage,
} from '../api/types'
import { useAuthStore } from '../stores/authStore'

export const CONVERSATIONS_KEY = ['conversations'] as const
export const conversationKey = (id: string) => ['conversation', id] as const

export function useConversations() {
  return useQuery({
    queryKey: CONVERSATIONS_KEY,
    queryFn: () => api<ConversationListResponse>('GET', '/api/conversations'),
    refetchInterval: 15000,
  })
}

export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: conversationKey(id ?? ''),
    queryFn: () => api<Conversation>('GET', `/api/conversations/${id}`),
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data
      if (data?.status === 'generating') return 5000
      return false
    },
  })
}

export function useCreateConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const fd = new FormData()
      fd.append('mode', 'create')
      return api<Conversation>('POST', '/api/conversations', fd)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CONVERSATIONS_KEY })
    },
  })
}

export function useDeleteConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>('DELETE', `/api/conversations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CONVERSATIONS_KEY })
    },
  })
}

export function usePatchDraft(convId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { patch: Partial<ChatDraft> | Record<string, unknown>; action?: string }) =>
      api<{ conversation: Conversation; message: ChatMessage }>(
        'PATCH',
        `/api/conversations/${convId}/draft`,
        body,
      ),
    onSuccess: (data) => {
      qc.setQueryData(conversationKey(convId), (old: Conversation | undefined) => {
        if (!old) return data.conversation
        return {
          ...data.conversation,
          messages: [...(old.messages ?? []), data.message],
        }
      })
      qc.invalidateQueries({ queryKey: CONVERSATIONS_KEY })
    },
  })
}

export function useSendMessage(convId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { content: string; files?: File[] }) => {
      const fd = new FormData()
      fd.append('content', input.content)
      for (const f of input.files ?? []) {
        fd.append('files', f)
      }
      return api<{
        conversation: Conversation
        user_message: ChatMessage
        assistant_message: ChatMessage
      }>('POST', `/api/conversations/${convId}/messages`, fd)
    },
    onSuccess: (data) => {
      qc.setQueryData(conversationKey(convId), (old: Conversation | undefined) => {
        const prev = old?.messages ?? []
        return {
          ...data.conversation,
          messages: [...prev, data.user_message, data.assistant_message],
        }
      })
      qc.invalidateQueries({ queryKey: CONVERSATIONS_KEY })
    },
  })
}

export function useGenerateFromChat(convId: string) {
  const qc = useQueryClient()
  const refreshMe = useAuthStore((s) => s.refresh)
  return useMutation({
    mutationFn: () =>
      api<{ job_id: string; conversation: Conversation }>(
        'POST',
        `/api/conversations/${convId}/generate`,
        { confirmed: true },
      ),
    onSuccess: (data) => {
      qc.setQueryData(conversationKey(convId), data.conversation)
      qc.invalidateQueries({ queryKey: CONVERSATIONS_KEY })
      qc.invalidateQueries({ queryKey: ['jobs'] })
      refreshMe()
    },
  })
}
