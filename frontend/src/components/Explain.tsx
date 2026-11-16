import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const WIDTH = 300
const GAP = 8

// "How we got this": a number that opens a small card saying what it counts and how it was worked out. The card is
// drawn on the page body and kept inside the screen, so no card or table around the number can hide or cut it.
export function Explain({
  children,
  title,
  text,
  calc,
}: {
  children: ReactNode
  title: string
  text: ReactNode
  calc?: string
}) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const card = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const b = button.current?.getBoundingClientRect()
      const h = card.current?.offsetHeight ?? 0
      if (!b) return
      const left = Math.max(12, Math.min(b.left, window.innerWidth - WIDTH - 12))
      const below = b.bottom + GAP
      const top = below + h > window.innerHeight - 12 && b.top - GAP - h > 12 ? b.top - GAP - h : below
      setAt({ left, top })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      const t = e.target as Node
      if (!button.current?.contains(t) && !card.current?.contains(t)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', away)
    window.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  return (
    <span className="xp">
      <button ref={button} type="button" className="xp-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        {children}
      </button>
      {open &&
        createPortal(
          <span
            ref={card}
            className="xp-card"
            role="dialog"
            aria-label={title}
            style={{ position: 'fixed', left: at?.left ?? -9999, top: at?.top ?? -9999, width: WIDTH }}
          >
            <b>{title}</b>
            <span>{text}</span>
            {calc && <code>{calc}</code>}
            <button type="button" className="link text-sm" onClick={() => setOpen(false)}>
              Got it
            </button>
          </span>,
          document.body,
        )}
    </span>
  )
}
