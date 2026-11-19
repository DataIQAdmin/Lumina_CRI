import { useEffect, useRef, useState, type FormEvent } from 'react'

import { api } from '../api/client'
import type { RegexGeneration } from '../api/types'
import { ORG_CODE } from '../organization'
import { Icon } from './Icon'

type Message = {
  id: string
  role: 'assistant' | 'user'
  text: string
  regex?: string
  matching?: string[]
  failing?: { value: string; why: string }[]
  error?: boolean
}

type Conversation = { id: string; title: string; messages: Message[]; updatedAt: number }

const HISTORY_KEY = `lumina-genie-history-v1:${ORG_CODE ?? 'default'}`
const WELCOME: Message = {
  id: 'welcome',
  role: 'assistant',
  text: 'Describe any value format and I will write a regex for it. For example: an Indian mobile number with +91, a PAN, a 6-digit PIN code, or an office or home address line. Ask a follow-up to refine the last regex.',
}

function restoreConversations(): Conversation[] {
  try {
    const stored = sessionStorage.getItem(HISTORY_KEY)
    if (!stored) return [{ id: 'chat-start', title: 'New chat', messages: [WELCOME], updatedAt: Date.now() }]
    const history = JSON.parse(stored) as Conversation[] | Message[]
    if (!Array.isArray(history) || !history.length) return [{ id: 'chat-start', title: 'New chat', messages: [WELCOME], updatedAt: Date.now() }]
    if ('messages' in history[0]) return history as Conversation[]
    // Keep a conversation saved by the first panel version when upgrading.
    return [{ id: 'chat-start', title: 'Previous chat', messages: history as Message[], updatedAt: Date.now() }]
  } catch {
    return [{ id: 'chat-start', title: 'New chat', messages: [WELCOME], updatedAt: Date.now() }]
  }
}

function localReply(prompt: string): string | null {
  const text = prompt.trim().toLowerCase()
  if (/^(hi|hello|hey|good morning|good afternoon|good evening)[!. ]*$/.test(text)) {
    return 'Hello! Describe a value format, like "Indian mobile with +91" or "home address line", and I will write the regex.'
  }
  if (/^(what can you do|what do you do|how can you help|what are your capabilities|help)\??$/.test(text)) {
    return 'I write and explain regular expressions for any value format: phone numbers (+91), PAN, Aadhaar, email, PIN code, IFSC, GSTIN, dates, names, home or office addresses and more. Each regex is checked and comes with passing and failing examples. I don’t apply rules; a data steward does that in Data quality → Column rules.'
  }
  return null
}

function replyFor(result: RegexGeneration) {
  return result.explanation || (result.pattern ? 'Here is a regex for that format.' : 'Describe the value format you need.')
}

// Any screen can open the Lumina AI panel, e.g. the rule dialog when someone needs a new regex.
const OPEN_EVENT = 'lumina:open-genie'
export const openGenie = () => window.dispatchEvent(new Event(OPEN_EVENT))
export const onOpenGenie = (open: () => void) => {
  window.addEventListener(OPEN_EVENT, open)
  return () => window.removeEventListener(OPEN_EVENT, open)
}

export function GeniePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [conversations, setConversations] = useState<Conversation[]>(restoreConversations)
  const [activeChat, setActiveChat] = useState(() => restoreConversations()[0]?.id ?? 'chat-start')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(conversations.map((chat) => ({ ...chat, messages: chat.messages.slice(-80) }))))
    } catch { /* A full or unavailable session store should not block chat. */ }
  }, [conversations])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const messages = conversations.find((chat) => chat.id === activeChat)?.messages ?? [WELCOME]

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, busy])

  const add = (message: Omit<Message, 'id'>) => {
    const nextMessage = { ...message, id: `${Date.now()}-${Math.random()}` }
    setConversations((old) => {
      const current = old.find((chat) => chat.id === activeChat)
      const updated: Conversation = {
        id: activeChat,
        title: current?.title === 'New chat' && message.role === 'user' ? message.text.slice(0, 42) : current?.title ?? 'New chat',
        messages: [...(current?.messages ?? [WELCOME]), nextMessage],
        updatedAt: Date.now(),
      }
      return [updated, ...old.filter((chat) => chat.id !== activeChat)]
    })
  }

  const copyRegex = async (regex: string) => {
    try {
      await navigator.clipboard.writeText(regex)
      add({ role: 'assistant', text: 'Regex copied to the clipboard.' })
    } catch {
      add({ role: 'assistant', text: 'Clipboard access was blocked. Select and copy the regex from the code block.' })
    }
  }

  const send = async (event: FormEvent) => {
    event.preventDefault()
    const text = prompt.trim()
    if (!text || busy) return
    setPrompt('')
    add({ role: 'user', text })
    const reply = localReply(text)
    if (reply) {
      add({ role: 'assistant', text: reply })
      return
    }
    // Earlier turns go along so a follow-up ("make +91 optional") can refine the last regex.
    const history = messages.filter((message) => message.id !== 'welcome' && !message.error)
      .slice(-6).map(({ role, text: said, regex }) => ({ role, text: said, regex }))
    setBusy(true)
    try {
      const result = await api.regexGenerate(text, history)
      add({ role: 'assistant', text: replyFor(result), regex: result.pattern || undefined, matching: result.matching, failing: result.failing })
    } catch (error) {
      add({ role: 'assistant', text: (error as Error).message, error: true })
    } finally {
      setBusy(false)
    }
  }

  const newChat = () => {
    const id = `chat-${Date.now()}`
    setConversations((old) => [{ id, title: 'New chat', messages: [WELCOME], updatedAt: Date.now() }, ...old])
    setActiveChat(id)
    setHistoryOpen(false)
  }

  return (
    <>
      {open && <button type="button" className="genie-scrim" aria-label="Close Lumina AI panel" onClick={onClose} />}
      <aside id="genie-panel" className={`genie-panel${open ? ' is-open' : ''}`} aria-label="Lumina AI assistant" aria-hidden={!open}>
        <header className="genie-head">
          <div className="genie-title"><BrandSymbol /><div><strong>Lumina AI</strong><span>Regex assistant</span></div></div>
          <div className="genie-head-actions">
            <button type="button" className="btn btn-ghost btn-icon" onClick={newChat} aria-label="Start a new chat" title="New chat"><Icon name="edit" /></button>
            <button type="button" className={`btn btn-ghost btn-icon${historyOpen ? ' is-active' : ''}`} onClick={() => setHistoryOpen((value) => !value)} aria-label="Show chat history" title="Chat history" aria-expanded={historyOpen}><Icon name="history" /></button>
            <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close Lumina AI"><Icon name="x" /></button>
          </div>
        </header>

        {historyOpen && <div className="genie-history" aria-label="Chat history">
          <div className="genie-history-title">Recent chats</div>
          {conversations.map((chat) => <button type="button" key={chat.id} className={`genie-history-item${chat.id === activeChat ? ' is-current' : ''}`} onClick={() => { setActiveChat(chat.id); setHistoryOpen(false) }}>
            <Icon name="history" size={15} /><span>{chat.title}</span>
          </button>)}
          {!conversations.length && <p className="muted text-sm">No saved chats yet.</p>}
        </div>}

        <div className="genie-messages" role="log" aria-live="polite" aria-label="Chat history">
          {messages.map((message) => <div key={message.id} className={`genie-message is-${message.role}${message.error ? ' has-error' : ''}`}>
            <p>{message.text}</p>
            {message.regex && <div className="genie-code-wrap"><code>{message.regex}</code><button type="button" className="btn btn-sm" onClick={() => void copyRegex(message.regex!)}><Icon name="copy" size={15} /> Copy</button>
              {(!!message.matching?.length || !!message.failing?.length) && <ul className="genie-examples" aria-label="Examples">
                {message.matching?.map((value) => <li key={`ok-${value}`}><span className="is-pass">✓</span><code>{value}</code></li>)}
                {message.failing?.map((item) => <li key={`bad-${item.value}`}><span className="is-fail">✗</span><code>{item.value || '(empty)'}</code>{item.why && <span className="why">{item.why}</span>}</li>)}
              </ul>}
            </div>}
          </div>)}
          {busy && <div className="genie-message is-assistant"><p className="genie-thinking"><span /> Writing a regex…</p></div>}
          <div ref={bottom} />
        </div>

        <div className="genie-compose-wrap">
          <div className="genie-prompts">
            <button type="button" className="genie-chip" onClick={() => setPrompt('What can you do?')}>What can you do?</button>
            <button type="button" className="genie-chip" onClick={() => setPrompt('Indian mobile number with optional +91')}>Mobile with +91</button>
            <button type="button" className="genie-chip" onClick={() => setPrompt('Office or home address line')}>Address line</button>
            <button type="button" className="genie-chip" onClick={() => setPrompt('PAN number')}>PAN</button>
            <button type="button" className="genie-chip" onClick={() => setPrompt('Email address up to 50 characters')}>Email</button>
          </div>
          <form className="genie-compose" onSubmit={send}>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() }
            }} placeholder="Describe any format, e.g. Indian mobile with +91…" aria-label="Ask Lumina AI" rows={2} disabled={busy} />
            <button type="submit" className="btn btn-primary btn-icon" aria-label="Send message" disabled={!prompt.trim() || busy}><Icon name="chevronRight" /></button>
          </form>
          <p className="genie-footnote">Regexes are checked before they are shown. Test one in Data quality before applying it.</p>
        </div>
      </aside>
    </>
  )
}

function BrandSymbol() {
  return <span className="genie-symbol"><span /><span /><span /></span>
}
