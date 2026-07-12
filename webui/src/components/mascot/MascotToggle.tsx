import { useMascotStore } from '../../stores/mascotStore'
import { HeaderIconButton } from '../ui/HeaderIconButton'
import { IconBot } from '../ui/icons'

export function MascotToggle() {
  const enabled = useMascotStore((s) => s.enabled)
  const toggleEnabled = useMascotStore((s) => s.toggleEnabled)

  return (
    <HeaderIconButton
      type="button"
      onClick={toggleEnabled}
      active={enabled}
      title={enabled ? '隐藏 ForgeBot 助手' : '显示 ForgeBot 助手'}
      aria-label={enabled ? '隐藏 ForgeBot 助手' : '显示 ForgeBot 助手'}
      aria-pressed={enabled}
    >
      <IconBot />
    </HeaderIconButton>
  )
}
