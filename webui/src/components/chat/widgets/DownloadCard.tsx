import { Link } from 'react-router-dom'
import { downloadUrl } from '../../../api/client'
import { useJob } from '../../../hooks/useJobs'

type Props = {
  jobId: string
}

export function DownloadCard({ jobId }: Props) {
  const { data: job } = useJob(jobId)
  const hasPptx = job?.status === 'done' && job.pptx_path

  if (!hasPptx) {
    return (
      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50">
        生成完成后可在此下载 PPTX
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
      <h3 className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">生成完成</h3>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => downloadUrl(`/api/jobs/${jobId}/download`, `ppt-${jobId.slice(0, 8)}.pptx`)}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          下载 PPTX
        </button>
        <Link
          to={`/jobs/${jobId}`}
          className="rounded-md border border-emerald-300 px-4 py-2 text-sm text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-200"
        >
          预览幻灯片
        </Link>
      </div>
    </div>
  )
}
