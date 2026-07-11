import { useModalStore } from '../../stores/modalStore'
import { Button } from './Button'
import { Card } from './Card'

export function ModalHost() {
  const open = useModalStore((s) => s.open)
  const config = useModalStore((s) => s.config)

  if (!open || !config) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-md shadow-xl" padding="lg">
        <h2 className="text-lg font-semibold">{config.title}</h2>
        <p className="mt-2 text-sm text-muted-fg">{config.body}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={config.onCancel}>
            {config.cancelText}
          </Button>
          <Button type="button" onClick={config.onConfirm}>
            {config.confirmText}
          </Button>
        </div>
      </Card>
    </div>
  )
}
