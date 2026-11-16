import { type ReactNode, useEffect, useRef } from 'react'

import { Icon } from './Icon'

// A popup in the centre of the screen. Closes with its ✕, the Esc key or a click outside it.
export function Dialog({
  title,
  subtitle,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  title: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}) {
  const box = useRef<HTMLElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    box.current?.querySelector<HTMLElement>('input, button.btn-primary, .dlg-x')?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="dlg-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section ref={box} className={`dlg is-${size}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <header className="dlg-h">
          <div className="dlg-titles">
            <h2>{title}</h2>
            {subtitle && <span className="muted text-sm">{subtitle}</span>}
          </div>
          <button type="button" className="dlg-x" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </header>
        <div className="dlg-b">{children}</div>
        {footer && <footer className="dlg-f">{footer}</footer>}
      </section>
    </div>
  )
}
