/* JSON parsing with friendly errors + ComfyUI workflow validator. Used by
 * JsonFileEditor. Lives outside so the validator can be reused for tests or
 * a CLI lint command later. */

export type ParseOk = { ok: true; value: Record<string, unknown> }
export type ParseError = {
  ok: false
  error: { line: number; col: number; message: string; raw: string }
}
export type ParseResult = ParseOk | ParseError

export function parseJsonFriendly(text: string): ParseResult {
  try {
    const v = JSON.parse(text)
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      return {
        ok: false,
        error: {
          line: 1,
          col: 1,
          message: 'Root value must be a JSON object {}',
          raw: 'Type mismatch',
        },
      }
    }
    return { ok: true, value: v as Record<string, unknown> }
  } catch (e) {
    const msg = String((e as Error).message ?? e)
    let line = 1,
      col = 1,
      friendly = msg
    const posMatch = msg.match(/position (\d+)/i)
    if (posMatch) {
      const pos = parseInt(posMatch[1], 10)
      const before = text.slice(0, pos)
      line = before.split('\n').length
      col = pos - before.lastIndexOf('\n')
    }
    const lineMatch = msg.match(/line (\d+) column (\d+)/i)
    if (lineMatch) {
      line = parseInt(lineMatch[1], 10)
      col = parseInt(lineMatch[2], 10)
    }
    if (/Unexpected token/i.test(msg) && !/,/.test(msg))
      friendly = `Unexpected character on line ${line}. You may be missing a comma or have extra punctuation.`
    else if (/Unexpected end of (JSON|input)/i.test(msg))
      friendly = `File ends too early — check every { has a closing } and [ has a ].`
    else if (/Expected double-quoted property name/i.test(msg))
      friendly = `Line ${line}: keys need double quotes, like "name" not name.`
    else if (/Unexpected string|Unexpected number/i.test(msg))
      friendly = `Line ${line}: missing a comma between two values.`
    else friendly = `Line ${line}: ${msg.replace(/^.*?:\s*/, '')}`
    return { ok: false, error: { line, col, message: friendly, raw: msg } }
  }
}

export type Issue = { level: 'error' | 'warn'; path?: string; message: string }

/** Walk a ComfyUI-shaped workflow object and surface obvious mistakes:
 *  missing class_type on a node, inputs that aren't objects, references to
 *  node ids that don't exist. */
export function validateComfy(obj: Record<string, unknown>): Issue[] {
  const issues: Issue[] = []
  const ids = Object.keys(obj)
  if (ids.length === 0) {
    issues.push({ level: 'warn', message: 'Workflow has no nodes.' })
    return issues
  }
  for (const id of ids) {
    const node = obj[id] as Record<string, unknown> | null
    if (!node || typeof node !== 'object') {
      issues.push({ level: 'error', path: id, message: `Node "${id}" should be an object.` })
      continue
    }
    if (!node['class_type'])
      issues.push({ level: 'error', path: id, message: `Node "${id}" is missing "class_type".` })
    if (node['inputs'] && typeof node['inputs'] !== 'object')
      issues.push({ level: 'error', path: id, message: `Node "${id}" — inputs must be an object.` })
    if (node['inputs'] && typeof node['inputs'] === 'object') {
      for (const [k, v] of Object.entries(node['inputs'] as Record<string, unknown>)) {
        if (
          Array.isArray(v) &&
          v.length === 2 &&
          (typeof v[0] === 'string' || typeof v[0] === 'number')
        ) {
          const ref = String(v[0])
          if (!obj[ref])
            issues.push({
              level: 'warn',
              path: `${id}.inputs.${k}`,
              message: `Node "${id}" → "${k}" refs node "${ref}" which doesn't exist.`,
            })
        }
      }
    }
  }
  return issues
}

export function prettify(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}
