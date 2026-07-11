export const APP_MAIN_SCROLL_ID = 'app-main-scroll'

const SCROLL_MARGIN = 80

export function resetMainScroll() {
  const main = document.getElementById(APP_MAIN_SCROLL_ID)
  if (main) main.scrollTop = 0
}

export function scrollMainToElement(
  id: string,
  options?: { align?: 'center' | 'nearest'; behavior?: ScrollBehavior },
) {
  const { align = 'center', behavior = 'smooth' } = options ?? {}

  const run = () => {
    const main = document.getElementById(APP_MAIN_SCROLL_ID)
    const el = document.getElementById(id)
    if (!main || !el) return

    const mainRect = main.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    const elTop = elRect.top - mainRect.top + main.scrollTop

    let targetScroll: number
    if (align === 'center') {
      targetScroll = elTop - main.clientHeight / 2 + elRect.height / 2
    } else {
      const visibleTop = main.scrollTop
      const visibleBottom = visibleTop + main.clientHeight
      const elBottom = elTop + elRect.height
      if (elTop >= visibleTop + SCROLL_MARGIN && elBottom <= visibleBottom) return
      targetScroll = elTop - SCROLL_MARGIN
    }

    main.scrollTo({ top: Math.max(0, targetScroll), behavior })
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setTimeout(run, 50)
    })
  })
}
