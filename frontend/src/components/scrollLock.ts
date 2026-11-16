import { useEffect } from 'react'

// While a popup, the search box or the phone menu is open, the page behind it must not scroll. Several can be open
// at once (a popup over a popup), so the page unlocks only when the last one closes.
let open = 0
let saved = { html: '', body: '' }

export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return
    const html = document.documentElement
    if (open === 0) {
      saved = { html: html.style.overflow, body: document.body.style.overflow }
      html.style.overflow = 'hidden'
      document.body.style.overflow = 'hidden'
    }
    open += 1
    return () => {
      open -= 1
      if (open === 0) {
        html.style.overflow = saved.html
        document.body.style.overflow = saved.body
      }
    }
  }, [active])
}
