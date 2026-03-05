import type { WorkflowJson } from '@/types'

export interface ModelInput {
  classType: string
  field: string
  value: string
}

export interface WorkflowDependencies {
  classTypes: string[]
  modelInputs: ModelInput[]
  fileInputs: ModelInput[]
}

/** Field names that are known to reference model files. */
const MODEL_FIELDS = new Set([
  'ckpt_name',
  'checkpoint_name',
  'lora_name',
  'vae_name',
  'clip_name',
  'clip_name1',
  'clip_name2',
  'unet_name',
  'control_net_name',
])

/**
 * Map of specific class_type + field name combinations that also reference
 * model files but use non-standard field names.
 */
const NODE_MODEL_FIELDS: Record<string, Set<string>> = {
  ModelPatchLoader: new Set(['name']),
}

/**
 * Node types whose specific fields reference input files (from ComfyUI's input/ folder).
 * These are checked via the same object_info dropdown mechanism.
 */
const INPUT_FILE_FIELDS: Record<string, Set<string>> = {
  LoadImage: new Set(['image']),
}

/**
 * Extract all unique class_type values, model input references, and input file
 * references from a ComfyUI workflow JSON (API format: Record<nodeId, nodeData>).
 */
export function extractWorkflowDependencies(workflowJson: WorkflowJson): WorkflowDependencies {
  const classTypes = new Set<string>()
  const modelInputsSeen = new Set<string>()
  const modelInputs: ModelInput[] = []
  const fileInputsSeen = new Set<string>()
  const fileInputs: ModelInput[] = []

  for (const nodeData of Object.values(workflowJson)) {
    if (!nodeData || typeof nodeData !== 'object') continue
    const node = nodeData as Record<string, unknown>

    const classType = typeof node.class_type === 'string' ? node.class_type : ''
    if (classType) {
      classTypes.add(classType)
    }

    const inputs = node.inputs as Record<string, unknown> | undefined
    if (!inputs || typeof inputs !== 'object') continue

    const extraModelFields = classType ? NODE_MODEL_FIELDS[classType] : undefined
    const inputFileFields = classType ? INPUT_FILE_FIELDS[classType] : undefined

    for (const [field, value] of Object.entries(inputs)) {
      if (typeof value !== 'string' || !value) continue

      // Check input file fields
      if (inputFileFields?.has(field)) {
        const key = `${classType}\0${field}\0${value}`
        if (!fileInputsSeen.has(key)) {
          fileInputsSeen.add(key)
          fileInputs.push({ classType, field, value })
        }
        continue
      }

      // Check model fields
      const isModelField = MODEL_FIELDS.has(field) || extraModelFields?.has(field)
      if (!isModelField) continue

      const key = `${classType}\0${field}\0${value}`
      if (modelInputsSeen.has(key)) continue
      modelInputsSeen.add(key)

      modelInputs.push({ classType, field, value })
    }
  }

  return {
    classTypes: [...classTypes].sort(),
    modelInputs,
    fileInputs,
  }
}
