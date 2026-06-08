/**
 * Deep cross-reference validation for a workflow's params.json + workflow.json
 * + SKILL.md. Used by the `validate_params` MCP tool and (potentially) future
 * pre-write hardening.
 *
 * Why this is separate from `validateParamsShape` in tool-helpers.ts:
 *  - validateParamsShape is fast + structural. It only looks at the params
 *    object's top-level keys, can't see workflow.json, and runs on every
 *    write to catch garbage before disk. Cheap and conservative.
 *  - This module is the *deep* check. It reads workflow.json too, walks
 *    every cross-reference (does nodeId X exist? does field Y exist on it?),
 *    and produces a full diagnostic report. Slower. Run on demand.
 *
 * The author of a workflow uses this through `validate_params` to confirm
 * everything points where it should before shipping. The AI uses it the same
 * way — after a sequence of edits, run it to make sure nothing dangles.
 *
 * Forward-compat note: when gt-plugins exposes a validation endpoint, this
 * module is the natural home for proxying it. The DeepValidationResult shape
 * is intentionally a superset of what we emit today so adding more checks
 * doesn't break consumers.
 */
import { resolveFolder, readParams } from '../services/workflows.js'
import { readWorkflowJsonForId, type ValidationIssue } from './tool-helpers.js'
import { readSkillMdAt, SKILL_MD_FILENAME } from './skill-md.js'

export type ValidationCheck = {
  section: 'params' | 'workflow' | 'comfyui_config' | 'powerflow' | 'imagine' | 'skill_md'
  id: string
  label: string
  ok: boolean
  detail?: string
}

export type DeepValidationResult = {
  workflowId: string
  valid: boolean
  summary: {
    errors: number
    warnings: number
    checksRun: number
    checksPassed: number
  }
  checks: ValidationCheck[]
  issues: ValidationIssue[]
}

/* ─── Small typed accessors ────────────────────────────────────── */

type Workflow = Record<string, { class_type?: string; inputs?: Record<string, unknown> }>

function getNode(wf: Workflow | null, nodeId: string) {
  if (!wf) return undefined
  return wf[nodeId]
}

function hasField(wf: Workflow | null, nodeId: string, fieldName: string): boolean {
  const node = getNode(wf, nodeId)
  if (!node || !node.inputs || typeof node.inputs !== 'object') return false
  return fieldName in node.inputs
}

/* ─── Per-section validators ───────────────────────────────────
   Each helper appends to the shared `checks` + `issues` arrays. Returning
   void keeps the call site flat — `runDeepValidation` chains them rather
   than collecting partial results.

   Convention: a check goes in `checks[]` as { ok: boolean, label, detail? }
   AND every fail also writes an entry into `issues[]` with level/path/
   message. The two are deliberately parallel: `checks` answers "what did
   you test?" (good for a UI table); `issues` answers "what's wrong?" (good
   for a model fix-it loop).
*/

function checkComfyConfig(
  params: Record<string, unknown>,
  workflow: Workflow | null,
  checks: ValidationCheck[],
  issues: ValidationIssue[],
): void {
  const cc = params.comfyui_config as Record<string, unknown> | undefined
  if (!cc) return

  // hiddenNodeIds / wrappedNodeIds — every id must exist in workflow.json.
  for (const arrKey of ['hiddenNodeIds', 'wrappedNodeIds'] as const) {
    const arr = cc[arrKey]
    if (!Array.isArray(arr)) continue
    const missing = arr.filter((id) => typeof id === 'string' && !getNode(workflow, id))
    const ok = missing.length === 0
    checks.push({
      section: 'comfyui_config',
      id: `${arrKey}_resolve`,
      label: `Every id in ${arrKey} exists in workflow.json`,
      ok,
      detail: ok ? undefined : `missing: ${missing.join(', ')}`,
    })
    if (!ok) {
      issues.push({
        level: 'error',
        path: `comfyui_config.${arrKey}`,
        message: `Unknown node ids: ${missing.join(', ')}. Run read_workflow to see valid ids.`,
      })
    }
  }

  // subgraphs.nodesOrder — every id must exist.
  const subgraphs = cc.subgraphs as Record<string, { nodesOrder?: unknown }> | undefined
  if (subgraphs && typeof subgraphs === 'object') {
    for (const [sgId, sg] of Object.entries(subgraphs)) {
      if (!sg || typeof sg !== 'object') continue
      const order = (sg as { nodesOrder?: unknown }).nodesOrder
      if (!Array.isArray(order)) continue
      const missing = order.filter((id) => typeof id === 'string' && !getNode(workflow, id))
      const ok = missing.length === 0
      checks.push({
        section: 'comfyui_config',
        id: `subgraph_${sgId}_order_resolve`,
        label: `subgraphs.${sgId}.nodesOrder references valid node ids`,
        ok,
        detail: ok ? undefined : `missing: ${missing.join(', ')}`,
      })
      if (!ok) {
        issues.push({
          level: 'error',
          path: `comfyui_config.subgraphs.${sgId}.nodesOrder`,
          message: `Unknown node ids: ${missing.join(', ')}.`,
        })
      }
    }
  }

  // node_parsers.input_nodes — keys must exist; per-field inputs must exist;
  // node-level and field-level connectTo references must resolve.
  const inputNodes = (cc.node_parsers as { input_nodes?: unknown } | undefined)?.input_nodes as
    | Record<string, Record<string, unknown>>
    | undefined
  if (inputNodes && typeof inputNodes === 'object') {
    for (const [nodeId, entry] of Object.entries(inputNodes)) {
      const nodeOk = !!getNode(workflow, nodeId)
      checks.push({
        section: 'comfyui_config',
        id: `node_parser_${nodeId}_resolve`,
        label: `node_parsers.input_nodes["${nodeId}"] targets an existing node`,
        ok: nodeOk,
      })
      if (!nodeOk) {
        issues.push({
          level: 'error',
          path: `comfyui_config.node_parsers.input_nodes.${nodeId}`,
          message: `Node "${nodeId}" not present in workflow.json — the parser entry will be ignored at runtime.`,
        })
        continue // can't field-check a missing node
      }
      const fieldsCfg = (entry?.inputs ?? {}) as Record<string, unknown>
      for (const fieldName of Object.keys(fieldsCfg)) {
        if (!hasField(workflow, nodeId, fieldName)) {
          checks.push({
            section: 'comfyui_config',
            id: `node_parser_${nodeId}_field_${fieldName}_resolve`,
            label: `Field "${fieldName}" exists on node ${nodeId}`,
            ok: false,
          })
          issues.push({
            level: 'error',
            path: `comfyui_config.node_parsers.input_nodes.${nodeId}.inputs.${fieldName}`,
            message: `Field "${fieldName}" is not declared on node ${nodeId}\'s inputs.`,
          })
        }

        // Field-level connectTo (auto-set value) — watched node + field.
        const fv = fieldsCfg[fieldName]
        if (fv && typeof fv === 'object' && !Array.isArray(fv)) {
          const fct = (fv as { connectTo?: { nodeId?: string; inputField?: string } }).connectTo
          if (fct) {
            const watchedOk = typeof fct.nodeId === 'string' && !!getNode(workflow, fct.nodeId)
            const watchedFieldOk =
              watchedOk &&
              typeof fct.inputField === 'string' &&
              hasField(workflow, fct.nodeId as string, fct.inputField)
            const ok = watchedOk && watchedFieldOk
            checks.push({
              section: 'comfyui_config',
              id: `field_connectto_${nodeId}_${fieldName}_resolve`,
              label: `Field connectTo on ${nodeId}.${fieldName} resolves`,
              ok,
              detail: ok
                ? undefined
                : !watchedOk
                  ? `watched node ${fct.nodeId} missing`
                  : `watched field ${fct.nodeId}.${fct.inputField} missing`,
            })
            if (!ok) {
              issues.push({
                level: 'error',
                path: `comfyui_config.node_parsers.input_nodes.${nodeId}.inputs.${fieldName}.connectTo`,
                message: !watchedOk
                  ? `Watched node "${fct.nodeId}" does not exist.`
                  : `Watched field "${fct.nodeId}.${fct.inputField}" does not exist.`,
              })
            }
          }
        }
      }

      // Node-level connectTo (visibility) — watched node + field.
      const nct = (entry as { connectTo?: { nodeId?: string; inputField?: string } }).connectTo
      if (nct) {
        const watchedOk = typeof nct.nodeId === 'string' && !!getNode(workflow, nct.nodeId)
        const watchedFieldOk =
          watchedOk &&
          typeof nct.inputField === 'string' &&
          hasField(workflow, nct.nodeId as string, nct.inputField)
        const ok = watchedOk && watchedFieldOk
        checks.push({
          section: 'comfyui_config',
          id: `node_connectto_${nodeId}_resolve`,
          label: `Node-level connectTo on ${nodeId} resolves`,
          ok,
        })
        if (!ok) {
          issues.push({
            level: 'error',
            path: `comfyui_config.node_parsers.input_nodes.${nodeId}.connectTo`,
            message: !watchedOk
              ? `Watched node "${nct.nodeId}" does not exist.`
              : `Watched field "${nct.nodeId}.${nct.inputField}" does not exist.`,
          })
        }
      }
    }
  }

  // outputComparator.inputNodeId — must exist in workflow.json (if set).
  const oc = cc.outputComparator as { inputNodeId?: string; defaultEnabled?: boolean } | undefined
  if (oc && typeof oc.inputNodeId === 'string' && oc.inputNodeId.length > 0) {
    const ok = !!getNode(workflow, oc.inputNodeId)
    checks.push({
      section: 'comfyui_config',
      id: 'outputComparator_resolve',
      label: `outputComparator.inputNodeId "${oc.inputNodeId}" exists in workflow.json`,
      ok,
    })
    if (!ok) {
      issues.push({
        level: 'error',
        path: 'comfyui_config.outputComparator.inputNodeId',
        message: `Node "${oc.inputNodeId}" does not exist in workflow.json.`,
      })
    }
  }
}

function checkPowerflow(
  params: Record<string, unknown>,
  workflow: Workflow | null,
  checks: ValidationCheck[],
  issues: ValidationIssue[],
): void {
  const pf = params.powerflowConfig as Record<string, unknown> | undefined
  if (!pf) return
  const ac = pf.availableConnections as
    | { inputs?: Array<{ nodeId?: string; fields?: unknown }>; outputs?: Array<{ nodeId?: string; fields?: unknown }> }
    | undefined
  if (!ac) return

  for (const side of ['inputs', 'outputs'] as const) {
    const list = ac[side]
    if (!Array.isArray(list)) continue
    for (const conn of list) {
      const nodeId = conn?.nodeId
      if (typeof nodeId !== 'string') continue
      const nodeOk = !!getNode(workflow, nodeId)
      checks.push({
        section: 'powerflow',
        id: `pf_${side}_${nodeId}_resolve`,
        label: `powerflow.availableConnections.${side}["${nodeId}"] targets an existing node`,
        ok: nodeOk,
      })
      if (!nodeOk) {
        issues.push({
          level: 'error',
          path: `powerflowConfig.availableConnections.${side}[].nodeId`,
          message: `Node "${nodeId}" does not exist in workflow.json.`,
        })
        continue
      }
      if (Array.isArray(conn.fields)) {
        for (const f of conn.fields as Array<string | { name?: string }>) {
          const fname = typeof f === 'string' ? f : f?.name
          if (typeof fname !== 'string') continue
          if (!hasField(workflow, nodeId, fname)) {
            checks.push({
              section: 'powerflow',
              id: `pf_${side}_${nodeId}_${fname}_resolve`,
              label: `Field "${fname}" exists on node ${nodeId}`,
              ok: false,
            })
            issues.push({
              level: 'error',
              path: `powerflowConfig.availableConnections.${side}[].fields.${fname}`,
              message: `Field "${fname}" is not declared on node ${nodeId}\'s inputs.`,
            })
          }
        }
      }
    }
  }
}

function checkImagine(
  workflowId: string,
  params: Record<string, unknown>,
  workflow: Workflow | null,
  checks: ValidationCheck[],
  issues: ValidationIssue[],
): void {
  const imagine = params.imagine as { mainMediaNode?: { id?: string; fieldName?: string; type?: string } } | undefined
  if (!imagine) return // imagine is optional — skip the section entirely

  const mn = imagine.mainMediaNode
  if (!mn) {
    issues.push({
      level: 'warning',
      path: 'imagine',
      message: 'imagine block is present but mainMediaNode is missing — set it via set_imagine_config.',
    })
    return
  }

  const idOk = typeof mn.id === 'string' && !!getNode(workflow, mn.id)
  checks.push({
    section: 'imagine',
    id: 'imagine_node_resolve',
    label: `imagine.mainMediaNode.id "${mn.id}" exists in workflow.json`,
    ok: idOk,
  })
  if (!idOk) {
    issues.push({
      level: 'error',
      path: 'imagine.mainMediaNode.id',
      message: `Node "${mn.id}" does not exist in workflow.json.`,
    })
  } else if (typeof mn.fieldName === 'string') {
    const fieldOk = hasField(workflow, mn.id as string, mn.fieldName)
    checks.push({
      section: 'imagine',
      id: 'imagine_field_resolve',
      label: `Field "${mn.fieldName}" exists on node ${mn.id}`,
      ok: fieldOk,
    })
    if (!fieldOk) {
      issues.push({
        level: 'error',
        path: 'imagine.mainMediaNode.fieldName',
        message: `Field "${mn.fieldName}" is not an input on node ${mn.id}.`,
      })
    }
  }

  // SKILL.md cross-checks live here too — same logic as validate_imagine but
  // inline so validate_params is a single-call diagnostic. Duplication is
  // mild and lets each tool stay self-contained.
  const { folderAbs } = resolveFolder(workflowId)
  const skill = readSkillMdAt(folderAbs)
  checks.push({
    section: 'skill_md',
    id: 'skill_md_exists',
    label: `${SKILL_MD_FILENAME} exists`,
    ok: skill.exists,
  })
  if (!skill.exists) {
    issues.push({
      level: 'error',
      path: SKILL_MD_FILENAME,
      message: `${SKILL_MD_FILENAME} is missing — run write_skill_md to create it.`,
    })
    return
  }
  if (!skill.frontmatter) {
    issues.push({
      level: 'error',
      path: `${SKILL_MD_FILENAME}.frontmatter`,
      message: `${SKILL_MD_FILENAME} has no YAML frontmatter.`,
    })
    return
  }
  const nameOk = skill.frontmatter.name === workflowId
  checks.push({
    section: 'skill_md',
    id: 'skill_name_matches',
    label: `${SKILL_MD_FILENAME} frontmatter.name == "${workflowId}"`,
    ok: nameOk,
  })
  if (!nameOk) {
    issues.push({
      level: 'error',
      path: `${SKILL_MD_FILENAME}.frontmatter.name`,
      message: `frontmatter.name should equal "${workflowId}", got ${JSON.stringify(skill.frontmatter.name ?? null)}.`,
    })
  }
  if (mn.type) {
    const fmType = skill.frontmatter.mediaType
    const typeOk = typeof fmType === 'string' && fmType.toLowerCase() === mn.type.toLowerCase()
    checks.push({
      section: 'skill_md',
      id: 'skill_mediaType_matches',
      label: `${SKILL_MD_FILENAME} frontmatter.mediaType == "${mn.type}"`,
      ok: typeOk,
    })
    if (!typeOk) {
      issues.push({
        level: 'error',
        path: `${SKILL_MD_FILENAME}.frontmatter.mediaType`,
        message: `frontmatter.mediaType should equal "${mn.type}", got ${JSON.stringify(fmType ?? null)}.`,
      })
    }
  }
}

/* ─── Public entry ────────────────────────────────────────────── */

export function runDeepValidation(workflowId: string): DeepValidationResult {
  const { folderAbs } = resolveFolder(workflowId)
  const params = readParams(folderAbs) as Record<string, unknown>
  const workflow = readWorkflowJsonForId(workflowId) as Workflow | null

  const checks: ValidationCheck[] = []
  const issues: ValidationIssue[] = []

  // Workflow file presence — every other cross-ref check needs this; if
  // workflow.json is missing or unparseable, downstream checks skip rather
  // than spam "node not found" for every reference.
  checks.push({
    section: 'workflow',
    id: 'workflow_readable',
    label: 'workflow.json is present and valid JSON',
    ok: !!workflow,
  })
  if (!workflow) {
    issues.push({
      level: 'error',
      path: 'workflow.json',
      message:
        'workflow.json is missing or could not be parsed. Cross-reference checks are skipped.',
    })
  }

  checkComfyConfig(params, workflow, checks, issues)
  checkPowerflow(params, workflow, checks, issues)
  checkImagine(workflowId, params, workflow, checks, issues)

  const errors = issues.filter((i) => i.level === 'error').length
  const warnings = issues.filter((i) => i.level === 'warning').length
  return {
    workflowId,
    valid: errors === 0,
    summary: {
      errors,
      warnings,
      checksRun: checks.length,
      checksPassed: checks.filter((c) => c.ok).length,
    },
    checks,
    issues,
  }
}
