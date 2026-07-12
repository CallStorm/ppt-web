import type { SseEvent, JobStatus } from '../api/types'

export const PIPELINE_STAGES = [
  '1 解析素材',
  '2 建项目',
  '3 策略规划(八点确认)',
  '4 分析源 PPT',
  '5 生图',
  '6 逐页生成 SVG',
  '7 质检',
  '8 后处理',
  '8 导出 PPTX',
] as const

const STAGE_SPEECH: Record<string, string[]> = {
  '1 解析素材': ['正在阅读你的素材…', '先把文档内容理清楚～'],
  '2 建项目': ['正在搭建项目结构…', '准备工作马上完成！'],
  '3 策略规划(八点确认)': ['正在规划演示策略…', '八点确认，确保方向正确'],
  '4 分析源 PPT': ['正在分析原始 PPT…', '提取版式与内容要点'],
  '5 生图': ['正在搜索和生成配图…', '让幻灯片更生动'],
  '6 逐页生成 SVG': ['正在一页一页画幻灯片…', '精心绘制每一页'],
  '7 质检': ['正在检查页面质量…', '确保每页都达标'],
  '8 后处理': ['正在做最后润色…', '快完成了，再等等～'],
  '8 导出 PPTX': ['正在打包 PPTX 文件…', '马上就能下载啦！'],
}

const STATUS_SPEECH: Partial<Record<JobStatus, string>> = {
  queued: '排队中，请稍候…',
  running: '开始为你生成 PPT！',
  paused: '等待你确认后继续…',
  done: '太棒了！PPT 已经生成完成 🎉',
  failed: '哎呀，生成遇到了问题…',
  cancelled: '任务已取消',
}

export function stageFromEvent(ev: SseEvent): string | null {
  if (ev.type === 'stage' && ev.payload.stage) return String(ev.payload.stage)
  if (ev.type === 'tool' && ev.payload.stage) return String(ev.payload.stage)
  return null
}

export function stageIndex(stage: string | null): number {
  if (!stage) return -1
  const idx = PIPELINE_STAGES.findIndex((s) => s === stage || stage.startsWith(s.split(' ')[0]))
  if (idx >= 0) return idx
  return PIPELINE_STAGES.findIndex((s) => stage.includes(s) || s.includes(stage))
}

export function stageToSpeech(
  stage: string | null,
  status: JobStatus,
  queuePosition?: number | null,
  rotate = 0,
): string {
  if (status === 'queued') {
    return queuePosition && queuePosition > 0
      ? `排队中，前面还有 ${queuePosition} 个任务`
      : STATUS_SPEECH.queued!
  }
  if (status === 'paused') return STATUS_SPEECH.paused!
  if (status === 'done') return STATUS_SPEECH.done!
  if (status === 'failed') return STATUS_SPEECH.failed!
  if (status === 'cancelled') return STATUS_SPEECH.cancelled!

  if (stage) {
    const lines = STAGE_SPEECH[stage]
    if (lines?.length) return lines[rotate % lines.length]!
    const partial = Object.entries(STAGE_SPEECH).find(([k]) => stage.startsWith(k.split(' ')[0]))
    if (partial) return partial[1][rotate % partial[1].length]!
  }
  return STATUS_SPEECH.running!
}

export type MascotMood = 'idle' | 'working' | 'celebrate' | 'error' | 'hidden'

export function moodFromStatus(status: JobStatus): MascotMood {
  if (status === 'done') return 'celebrate'
  if (status === 'failed' || status === 'cancelled') return 'error'
  if (status === 'queued') return 'idle'
  if (status === 'paused') return 'idle'
  return 'working'
}
