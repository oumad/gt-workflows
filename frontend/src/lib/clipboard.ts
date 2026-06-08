/**
 * Cross-context "copy text to clipboard" helper.
 *
 * navigator.clipboard.writeText() is the modern API but requires a SECURE
 * CONTEXT (HTTPS, or http://localhost). On a plain-HTTP origin — typical when
 * the app is reached over a private network like ZeroTier or a LAN IP — the
 * `navigator.clipboard` namespace is *undefined*, so any code that does
 * `navigator.clipboard?.writeText(...)` silently no-ops and the user wonders
 * why the copy button "doesn't work."
 *
 * This helper tries the modern API first, and falls back to the legacy
 * `document.execCommand('copy')` path via a hidden textarea when the modern
 * API is unavailable or rejects. execCommand is deprecated but every browser
 * that ships with `<button>` still supports it for the foreseeable future,
 * and crucially it works on plain-HTTP origins. The legacy path is also a
 * synchronous transaction — it must be invoked from a user gesture handler
 * (which every call site here is, since they're all onClick).
 *
 * Returns true on success, false on any failure. Never throws.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Path 1: modern async clipboard API. Available in secure contexts.
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to the legacy path */
  }

  // Path 2: hidden textarea + document.execCommand('copy'). Works on
  // insecure origins. We position off-screen to avoid causing layout shift
  // or flashing focus on mobile. readOnly on the textarea prevents the
  // virtual keyboard from popping up on touch devices when we focus it.
  if (typeof document === 'undefined') return false
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '0'
  ta.style.left = '0'
  ta.style.width = '1px'
  ta.style.height = '1px'
  ta.style.padding = '0'
  ta.style.border = '0'
  ta.style.opacity = '0'
  ta.style.pointerEvents = 'none'
  document.body.appendChild(ta)
  // Save the current selection so we can restore it afterwards — copying
  // shouldn't disturb whatever the user had highlighted.
  const prevSelection = document.getSelection()
  const prevRange =
    prevSelection && prevSelection.rangeCount > 0 ? prevSelection.getRangeAt(0) : null
  let ok = false
  try {
    ta.select()
    ta.setSelectionRange(0, text.length)
    ok = document.execCommand('copy')
  } catch {
    ok = false
  } finally {
    document.body.removeChild(ta)
    if (prevRange && prevSelection) {
      prevSelection.removeAllRanges()
      prevSelection.addRange(prevRange)
    }
  }
  return ok
}
