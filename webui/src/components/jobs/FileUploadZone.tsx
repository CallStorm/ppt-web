import { useState } from 'react'
import {
  SUPPORTED_FORMATS_LABEL,
  UPLOAD_ACCEPT,
  UPLOAD_LIMITS,
} from '../../lib/uploadFormats'

interface FileUploadZoneProps {
  files: File[]
  onChange: (files: File[]) => void
}

function CloudUploadIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mx-auto h-12 w-12 text-gemini-500"
      aria-hidden
    >
      <path d="M14 32h20a6 6 0 0 0 1.2-11.88A8.5 8.5 0 0 0 12.5 20.5 6.5 6.5 0 0 0 14 32z" />
      <path d="M24 28V16" />
      <path d="M19 21l5-5 5 5" />
    </svg>
  )
}

export function FileUploadZone({ files, onChange }: FileUploadZoneProps) {
  const [dragOver, setDragOver] = useState(false)

  const handleFiles = (list: FileList | null) => {
    if (!list) return
    onChange([...files, ...Array.from(list)])
  }

  const removeFile = (index: number) => {
    onChange(files.filter((_, i) => i !== index))
  }

  return (
    <div>
      <span className="text-xs text-slate-500">附件素材（可选）</span>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          handleFiles(e.dataTransfer.files)
        }}
        className={`mt-1 rounded-lg border-2 border-dashed px-4 py-8 text-center text-sm transition-colors ${
          dragOver
            ? 'border-gemini-500 bg-gemini-50 dark:bg-gemini-900/20'
            : 'border-slate-200 dark:border-slate-700'
        }`}
      >
        <CloudUploadIcon />
        <p className="mt-3 text-slate-600 dark:text-slate-300">
          拖拽文件到此处，或{' '}
          <label className="cursor-pointer font-medium text-gemini-600 hover:underline">
            点击上传
            <input
              type="file"
              multiple
              accept={UPLOAD_ACCEPT}
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </label>
        </p>
        <p className="mt-2 text-xs text-slate-400">支持 {SUPPORTED_FORMATS_LABEL}</p>
        <p className="mt-1 text-xs text-slate-400">
          单文件 ≤{UPLOAD_LIMITS.singleMb}MB，总计 ≤{UPLOAD_LIMITS.totalMb}MB
        </p>

        {files.length > 0 && (
          <ul className="mx-auto mt-4 max-w-md text-left text-xs text-slate-500">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center justify-between border-t border-slate-100 py-2 first:border-t-0 dark:border-slate-800">
                <span className="truncate pr-2">{f.name}</span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="shrink-0 text-rose-500 hover:text-rose-600"
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
