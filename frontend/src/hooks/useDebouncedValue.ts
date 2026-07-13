import { useEffect, useState } from 'react'

/** Returns `value` after it has been stable for `delayMs`. Standard
 *  search-box debounce — replaces the copy-pasted setTimeout effects. */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}
