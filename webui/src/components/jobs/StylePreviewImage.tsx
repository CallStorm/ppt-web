import { useState } from 'react'
import type { JobVisualStyle } from '../../lib/jobOptions'
import { VISUAL_STYLE_SWATCH } from '../../lib/jobOptions'
import {
  type PreviewSlideKind,
  visualStyleCollageUrl,
  visualStylePreviewUrl,
} from '../../lib/visualStyleCatalog'

export function StylePreviewImage({
  styleId,
  kind = 'cover',
  className = '',
  alt = '',
}: {
  styleId: JobVisualStyle
  kind?: PreviewSlideKind
  className?: string
  alt?: string
}) {
  const [failed, setFailed] = useState(false)
  const sw = VISUAL_STYLE_SWATCH[styleId]

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center ${sw.bg} ${className}`}
        aria-hidden
      >
        {sw.glyph}
      </div>
    )
  }

  const src =
    styleId === 'auto'
      ? visualStyleCollageUrl()
      : visualStylePreviewUrl(styleId, kind)

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
    />
  )
}
