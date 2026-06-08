import { useState, type DragEvent } from 'react'

/**
 * Drag-and-drop of an external file onto an element.
 *
 * Returns a `fileDragOver` flag (drive a `<FileDropOverlay/>` with it) plus
 * three handlers. `onDragOver` and `onDrop` each return whether they consumed
 * a *file* drag — so a host that also handles other drag types (e.g. a card
 * being reordered) can compose them: call the hook handler first, and only
 * fall through to the other logic when it returns `false`.
 */
export function useFileDrop(onFile: (file: File) => void, opts: { disabled?: boolean } = {}) {
  const [fileDragOver, setFileDragOver] = useState(false)
  const disabled = opts.disabled ?? false

  return {
    fileDragOver,

    /** @returns true when this is a file drag (and was handled). */
    onDragOver(e: DragEvent): boolean {
      if (disabled || !e.dataTransfer.types.includes('Files')) return false
      e.preventDefault()
      setFileDragOver(true)
      return true
    },

    onDragLeave(): void {
      setFileDragOver(false)
    },

    /** @returns true when a file was dropped (and passed to `onFile`). */
    onDrop(e: DragEvent): boolean {
      if (disabled) return false
      const file = e.dataTransfer.files?.[0]
      setFileDragOver(false)
      if (!file) return false
      e.preventDefault()
      onFile(file)
      return true
    },
  }
}
