import {
  AUDIENCE_OPTIONS,
  DEFAULT_JOB_OPTIONS,
  LANGUAGE_OPTIONS,
  PAGE_COUNT_MAX,
  PAGE_COUNT_MIN,
  SCENARIO_OPTIONS,
  TONE_OPTIONS,
  type JobOptions,
  type OptionItem,
} from '../../lib/jobOptions'

interface JobOptionsPanelProps {
  value: JobOptions
  onChange: (next: JobOptions) => void
}

const SELECT_CLASS =
  'w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800'

function OptionSelect<T extends string>({
  label,
  options,
  value,
  onChange,
  className = 'flex-1 min-w-[6.5rem]',
}: {
  label: string
  options: OptionItem<T>[]
  value: T
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <label className={`flex flex-col gap-0.5 ${className}`}>
      <span className="text-xs text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={SELECT_CLASS}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )
}

const PAGE_COUNT_OPTIONS = Array.from(
  { length: PAGE_COUNT_MAX - PAGE_COUNT_MIN + 1 },
  (_, i) => {
    const n = PAGE_COUNT_MIN + i
    return { value: String(n), label: `${n} 页` }
  },
)

export function JobOptionsPanel({ value, onChange }: JobOptionsPanelProps) {
  const set = <K extends keyof JobOptions>(key: K, v: JobOptions[K]) => {
    onChange({ ...value, [key]: v })
  }

  return (
    <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <OptionSelect
          label="语言"
          options={LANGUAGE_OPTIONS}
          value={value.language}
          onChange={(v) => set('language', v)}
        />
        <OptionSelect
          label="场景"
          options={SCENARIO_OPTIONS}
          value={value.scenario}
          onChange={(v) => set('scenario', v)}
          className="flex-1 min-w-[7.5rem]"
        />
        <OptionSelect
          label="受众"
          options={AUDIENCE_OPTIONS}
          value={value.audience}
          onChange={(v) => set('audience', v)}
          className="flex-1 min-w-[7.5rem]"
        />
        <OptionSelect
          label="语调"
          options={TONE_OPTIONS}
          value={value.tone}
          onChange={(v) => set('tone', v)}
        />
        <label className="flex w-20 flex-none flex-col gap-0.5">
          <span className="text-xs text-slate-500">页数</span>
          <select
            value={String(value.page_count)}
            onChange={(e) => set('page_count', parseInt(e.target.value, 10))}
            className={SELECT_CLASS}
          >
            {PAGE_COUNT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}

export { DEFAULT_JOB_OPTIONS }
