/* JSON syntax tokenizer + brace-folding utilities for the JsonFileEditor's
 * highlight overlay and gutter fold buttons. Lives outside the editor file so
 * the editor stays focused on UI; this module has zero React deps. */

/* ─── Syntax tokenizer ─────────────────────────────────────────── */

export type TokenType = 'key' | 'string' | 'num' | 'bool' | 'null' | 'punct' | 'ws' | 'text'
export type Token = { type: TokenType; value: string }

export const JSON_COLOR: Record<TokenType, string | undefined> = {
  key: 'var(--info)',
  string: 'var(--accent-ink)',
  num: 'var(--good)',
  bool: 'var(--pop-purple)',
  null: 'var(--pop-purple)',
  punct: 'var(--ink-3)',
  ws: undefined,
  text: 'var(--ink)',
}

export function tokenizeJson(text: string): Token[] {
  const tokens: Token[] = []
  const len = text.length
  let i = 0
  while (i < len) {
    const c = text[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      let j = i + 1
      while (
        j < len &&
        (text[j] === ' ' || text[j] === '\t' || text[j] === '\n' || text[j] === '\r')
      )
        j++
      tokens.push({ type: 'ws', value: text.slice(i, j) })
      i = j
      continue
    }
    if (c === '"') {
      let j = i + 1
      while (j < len) {
        if (text[j] === '\\' && j + 1 < len) {
          j += 2
          continue
        }
        if (text[j] === '"') {
          j++
          break
        }
        j++
      }
      // A string followed (after whitespace) by `:` is a property key.
      let k = j
      while (k < len && (text[k] === ' ' || text[k] === '\t')) k++
      const isKey = text[k] === ':'
      tokens.push({ type: isKey ? 'key' : 'string', value: text.slice(i, j) })
      i = j
      continue
    }
    if (c === '-' || (c >= '0' && c <= '9')) {
      let j = i
      if (text[j] === '-') j++
      while (j < len && /[0-9.eE+-]/.test(text[j])) j++
      tokens.push({ type: 'num', value: text.slice(i, j) })
      i = j
      continue
    }
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
      let j = i
      while (j < len && /[a-zA-Z]/.test(text[j])) j++
      const word = text.slice(i, j)
      if (word === 'true' || word === 'false') tokens.push({ type: 'bool', value: word })
      else if (word === 'null') tokens.push({ type: 'null', value: word })
      else tokens.push({ type: 'text', value: word })
      i = j
      continue
    }
    tokens.push({ type: 'punct', value: c })
    i++
  }
  return tokens
}

/* ─── Fold range computation ───────────────────────────────────── */

export type FoldRange = {
  startLine: number
  endLine: number
  openCh: '{' | '['
  closeCh: '}' | ']'
}

export function computeFoldRanges(text: string): FoldRange[] {
  const ranges: FoldRange[] = []
  const stack: { line: number; ch: '{' | '[' }[] = []
  const lines = text.split('\n')
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    let inStr = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (inStr) {
        if (c === '\\' && i + 1 < line.length) {
          i++
          continue
        }
        if (c === '"') inStr = false
        continue
      }
      if (c === '"') {
        inStr = true
        continue
      }
      if (c === '{' || c === '[') {
        stack.push({ line: li + 1, ch: c })
      } else if (c === '}' || c === ']') {
        const top = stack.pop()
        if (top && top.line < li + 1) {
          ranges.push({
            startLine: top.line,
            endLine: li + 1,
            openCh: top.ch,
            closeCh: c as '}' | ']',
          })
        }
      }
    }
  }
  return ranges
}

export type DisplayLine = {
  sourceLine: number // 1-based source line this display row corresponds to
  content: string // text rendered on this row (may include " ⋯ " for folds)
  foldStartHere: boolean // line begins a foldable range (collapsed or not)
  folded: boolean // this fold is currently collapsed
}

export function computeDisplayLines(
  text: string,
  folds: Set<number>,
  rangeByStart: Map<number, FoldRange>,
): DisplayLine[] {
  const lines = text.split('\n')
  const result: DisplayLine[] = []
  let i = 0
  while (i < lines.length) {
    const lineNum = i + 1
    const range = rangeByStart.get(lineNum)
    const isFolded = !!range && folds.has(lineNum)
    if (range && isFolded) {
      const openLine = lines[range.startLine - 1]
      const closeLine = lines[range.endLine - 1]
      // Match the open bracket on the start line and the close on the end line.
      const openIdx = range.openCh === '{' ? openLine.lastIndexOf('{') : openLine.lastIndexOf('[')
      const closeIdx = closeLine.indexOf(range.closeCh)
      const prefix = openIdx >= 0 ? openLine.slice(0, openIdx + 1) : openLine
      const suffix = closeIdx >= 0 ? closeLine.slice(closeIdx) : closeLine
      result.push({
        sourceLine: lineNum,
        content: prefix + ' ⋯ ' + suffix,
        foldStartHere: true,
        folded: true,
      })
      i = range.endLine
    } else {
      result.push({
        sourceLine: lineNum,
        content: lines[i],
        foldStartHere: !!range,
        folded: false,
      })
      i++
    }
  }
  return result
}
