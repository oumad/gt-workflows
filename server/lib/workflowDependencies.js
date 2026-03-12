const MODEL_FIELDS = new Set([
  'ckpt_name', 'checkpoint_name', 'lora_name', 'vae_name',
  'clip_name', 'clip_name1', 'clip_name2', 'unet_name', 'control_net_name',
]);

const NODE_MODEL_FIELDS = {
  ModelPatchLoader: new Set(['name']),
};

const INPUT_FILE_FIELDS = {
  LoadImage: new Set(['image']),
};

/**
 * Extract all unique class_type values, model input references, and input file
 * references from a ComfyUI workflow JSON (API format: Record<nodeId, nodeData>).
 */
export function extractWorkflowDependencies(workflowJson) {
  const classTypes = new Set();
  const modelInputsSeen = new Set();
  const modelInputs = [];
  const fileInputsSeen = new Set();
  const fileInputs = [];

  for (const nodeData of Object.values(workflowJson)) {
    if (!nodeData || typeof nodeData !== 'object') continue;

    const classType = typeof nodeData.class_type === 'string' ? nodeData.class_type : '';
    if (classType) classTypes.add(classType);

    const inputs = nodeData.inputs;
    if (!inputs || typeof inputs !== 'object') continue;

    const extraModelFields = classType ? NODE_MODEL_FIELDS[classType] : undefined;
    const inputFileFields = classType ? INPUT_FILE_FIELDS[classType] : undefined;

    for (const [field, value] of Object.entries(inputs)) {
      if (typeof value !== 'string' || !value) continue;

      if (inputFileFields?.has(field)) {
        const key = `${classType}\0${field}\0${value}`;
        if (!fileInputsSeen.has(key)) {
          fileInputsSeen.add(key);
          fileInputs.push({ classType, field, value });
        }
        continue;
      }

      const isModelField = MODEL_FIELDS.has(field) || extraModelFields?.has(field);
      if (!isModelField) continue;

      const key = `${classType}\0${field}\0${value}`;
      if (modelInputsSeen.has(key)) continue;
      modelInputsSeen.add(key);
      modelInputs.push({ classType, field, value });
    }
  }

  return {
    classTypes: [...classTypes].sort(),
    modelInputs,
    fileInputs,
  };
}
