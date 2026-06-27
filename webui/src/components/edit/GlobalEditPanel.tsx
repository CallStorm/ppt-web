import type {
  ContentPreset,
  EditTargetSlide,
  GlobalRevision,
  GlobalRevisionKind,
  SpecSummary,
} from '../../api/types'
import { VisualStyleGallery } from '../jobs/VisualStyleGallery'
import {
  collectColorChanges,
  ColorPaletteEditor,
} from './ColorPaletteEditor'
import { GlobalEditTypeCards } from './GlobalEditTypeCards'
import {
  CONTENT_PRESET_OPTIONS,
  FONT_FAMILY_OPTIONS,
  VISUAL_STYLE_OPTIONS,
  type JobVisualStyle,
} from '../../lib/jobOptions'

const MAX_CUSTOM = 2000

export function buildGlobalRevisionPayload(
  kind: GlobalRevisionKind,
  state: {
    colorDraft: Record<string, string>
    fontFamily: string
    visualStyle: JobVisualStyle
    contentPreset: ContentPreset | null
    contentComment: string
    customComment: string
  },
  specSummary: SpecSummary | null,
): GlobalRevision | null {
  if (kind === 'colors') {
    const changes = collectColorChanges(
      specSummary?.colors ?? {},
      state.colorDraft,
    )
    if (Object.keys(changes).length === 0) return null
    return { kind: 'colors', color_changes: changes }
  }
  if (kind === 'typography') {
    if (!state.fontFamily.trim()) return null
    return { kind: 'typography', font_family: state.fontFamily.trim() }
  }
  if (kind === 'visual_style') {
    if (!state.visualStyle || state.visualStyle === 'auto') return null
    return { kind: 'visual_style', visual_style: state.visualStyle }
  }
  if (kind === 'content') {
    const comment = state.contentComment.trim()
    if (!state.contentPreset && !comment) return null
    return {
      kind: 'content',
      content_preset: state.contentPreset,
      comment: comment || null,
    }
  }
  const comment = state.customComment.trim()
  if (!comment) return null
  return { kind: 'custom', comment }
}

export function GlobalEditPanel({
  slides,
  specSummary,
  kind,
  onKindChange,
  colorDraft,
  onColorDraftChange,
  fontFamily,
  onFontFamilyChange,
  visualStyle,
  onVisualStyleChange,
  contentPreset,
  onContentPresetChange,
  contentComment,
  onContentCommentChange,
  customComment,
  onCustomCommentChange,
}: {
  slides: EditTargetSlide[]
  specSummary: SpecSummary | null
  kind: GlobalRevisionKind
  onKindChange: (k: GlobalRevisionKind) => void
  colorDraft: Record<string, string>
  onColorDraftChange: (key: string, value: string) => void
  fontFamily: string
  onFontFamilyChange: (v: string) => void
  visualStyle: JobVisualStyle
  onVisualStyleChange: (v: JobVisualStyle) => void
  contentPreset: ContentPreset | null
  onContentPresetChange: (v: ContentPreset | null) => void
  contentComment: string
  onContentCommentChange: (v: string) => void
  customComment: string
  onCustomCommentChange: (v: string) => void
}) {
  const hasSpec = !!specSummary?.has_spec_lock
  const disabledKinds: GlobalRevisionKind[] = hasSpec
    ? []
    : ['colors', 'typography']

  const nonAutoStyles = VISUAL_STYLE_OPTIONS.filter((o) => o.value !== 'auto')

  return (
    <div className="space-y-4">
      <GlobalEditTypeCards
        value={kind}
        onChange={onKindChange}
        disabledKinds={disabledKinds}
      />

      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        {kind === 'colors' && hasSpec && (
          <ColorPaletteEditor
            currentColors={specSummary?.colors ?? {}}
            changes={colorDraft}
            onChange={onColorDraftChange}
          />
        )}

        {kind === 'typography' && hasSpec && (
          <div className="space-y-2">
            <label className="block text-xs text-slate-500 dark:text-slate-400">
              目标字体栈
            </label>
            <select
              value={fontFamily}
              onChange={(e) => onFontFamilyChange(e.target.value)}
              className="w-full rounded border border-slate-200 bg-white px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="">选择字体…</option>
              {FONT_FAMILY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {kind === 'visual_style' && (
          <div className="space-y-3">
            <p className="text-xs text-amber-700 dark:text-amber-300">
              将按新风格重画全部 {slides.length} 页，耗时明显长于换色/换字，布局可能变化。
            </p>
            <VisualStyleGallery
              value={visualStyle === 'auto' ? 'swiss-minimal' : visualStyle}
              onChange={(v) => {
                if (v !== 'auto') onVisualStyleChange(v)
              }}
              coreTopic=""
              showAuto={false}
            />
            <p className="text-xs text-slate-500">
              可选风格：{nonAutoStyles.map((o) => o.label.split('·')[0].trim()).join('、')}
            </p>
          </div>
        )}

        {kind === 'content' && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              尽量保留现有版式，仅调整文字。
            </p>
            <div className="flex flex-wrap gap-2">
              {CONTENT_PRESET_OPTIONS.map((opt) => {
                const active = contentPreset === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() =>
                      onContentPresetChange(active ? null : opt.value)
                    }
                    className={`rounded-full px-3 py-1 text-xs transition ${
                      active
                        ? 'bg-gemini-500 text-white'
                        : 'border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
            <textarea
              value={contentComment}
              onChange={(e) =>
                onContentCommentChange(e.target.value.slice(0, MAX_CUSTOM))
              }
              placeholder="补充说明（可选）"
              rows={3}
              className="w-full resize-y rounded border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
        )}

        {kind === 'custom' && (
          <textarea
            value={customComment}
            onChange={(e) =>
              onCustomCommentChange(e.target.value.slice(0, MAX_CUSTOM))
            }
            placeholder="例如：把所有页的标题统一加大一号；整体换成深色背景浅色字；删掉每页页脚…"
            rows={6}
            className="w-full resize-y rounded border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
            maxLength={MAX_CUSTOM}
          />
        )}
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        影响范围：全部 {slides.length} 页
      </p>
    </div>
  )
}
