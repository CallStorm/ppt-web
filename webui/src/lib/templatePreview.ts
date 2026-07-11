import type { TemplateCatalogEntry } from './jobOptions'

export function templatePreviewUrl(entry: TemplateCatalogEntry, svgName: string): string {
  return `/api/templates/${entry.kind}/${encodeURIComponent(entry.id)}/preview/${encodeURIComponent(svgName)}`
}

export function templateSlideLabel(svgName: string): string {
  const base = svgName.replace(/\.svg$/i, '').replace(/^\d+[a-z]?_/, '')
  if (base.includes('cover')) return '封面'
  if (base.includes('toc')) return '目录'
  if (base.includes('chapter')) return '章节'
  if (base.includes('content')) return '内容'
  if (base.includes('ending')) return '结尾'
  if (base.includes('reference')) return '参考样式'
  return base.replace(/_/g, ' ')
}

export function templatePreviewSlides(entry: TemplateCatalogEntry): string[] {
  if (entry.preview_slides.length > 0) return entry.preview_slides
  if (entry.cover_svg) return [entry.cover_svg]
  return []
}
