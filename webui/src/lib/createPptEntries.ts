export type CreatePptEntry = {
  key: string
  icon: string
  label: string
  description: string
  to: string
  match: (pathname: string) => boolean
}

export const CREATE_PPT_ENTRIES: CreatePptEntry[] = [
  {
    key: 'chat',
    icon: '💬',
    label: 'AI 智能对话',
    description: '通过聊天描述需求',
    to: '/chat',
    match: (p) => p.startsWith('/chat'),
  },
  {
    key: 'material',
    icon: '📄',
    label: '导入文档/大纲',
    description: '上传 Word / MD 快速生成',
    to: '/jobs/new',
    match: (p) => p.startsWith('/jobs/new'),
  },
  {
    key: 'beautify',
    icon: '✨',
    label: '导入旧 PPT 美化',
    description: '上传现有文件重新排版',
    to: '/jobs/beautify',
    match: (p) => p.startsWith('/jobs/beautify'),
  },
]

export function isCreatePptRoute(pathname: string): boolean {
  return CREATE_PPT_ENTRIES.some((item) => item.match(pathname))
}
