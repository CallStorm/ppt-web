import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { TemplateTask } from '../lib/templateTasks'

export const TEMPLATE_TASKS_KEY = ['templates', 'tasks'] as const

export function useTemplateTasks() {
  return useQuery({
    queryKey: TEMPLATE_TASKS_KEY,
    queryFn: () => api<{ tasks: TemplateTask[] }>('GET', '/api/templates/tasks'),
    refetchInterval: (query) => {
      const tasks = query.state.data?.tasks ?? []
      return tasks.some((t) => t.status === 'generating') ? 10000 : false
    },
  })
}

export function useRetryTemplateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dbId: string) =>
      api<{ template: TemplateTask; job_id: string; status: string }>(
        'POST',
        `/api/templates/records/${dbId}/retry`,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TEMPLATE_TASKS_KEY })
      qc.invalidateQueries({ queryKey: ['templates', 'library'] })
    },
  })
}
