export const SUPPORTED_UPLOAD_FORMATS = [
  'PDF',
  'DOCX',
  'PPTX',
  'XLSX',
  'MD',
  'HTML',
  'EPUB',
  'TXT',
  '图片',
] as const

export const UPLOAD_LIMITS = { singleMb: 25, totalMb: 50 }

export const UPLOAD_ACCEPT =
  '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.md,.html,.htm,.epub,.txt,.png,.jpg,.jpeg,.gif,.webp,.svg'

export const SUPPORTED_FORMATS_LABEL = SUPPORTED_UPLOAD_FORMATS.join(' · ')
