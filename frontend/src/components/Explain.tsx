import { type ReactNode, useEffect, useRef, useState } from 'react'

// "How we got this": a number that opens a small card saying what it counts and how it was worked out.
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
  const wrap = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', away)
    window.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', key)
    }
  }, [open])
  return (
    <span ref={wrap} className="xp">
      <button type="button" className="xp-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        {children}
      </button>
      {open && (
        <span className="xp-card" role="dialog" aria-label={title}>
          <b>{title}</b>
          <span>{text}</span>
          {calc && <code>{calc}</code>}
          <button type="button" className="link text-sm" onClick={() => setOpen(false)}>
            Got it
          </button>
        </span>
      )}
    </span>
  )
}
