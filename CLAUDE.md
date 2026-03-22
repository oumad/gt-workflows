# GT Workflows - Agent Guide

This is the authoritative reference for creating, modifying, and debugging ComfyUI workflows for Gear Tracker's Workflow Studio plugin. Follow these patterns exactly.

## Project Structure

```
data/gt-workflows/<Workflow Name>/
  workflow.json   # ComfyUI API-format node graph
  params.json     # GT UI configuration
  icon.jpg        # Thumbnail for workflow card
```

Additional docs:
- `.cursor/rules/workflow-studio.mdc` — official Workflow Studio documentation (params.json schema, node parsers, connectTo, selectors)
- `gt-plugins/services/backend/documentation/engines/workflow-studio.md` — backend engine docs

---

## 1. workflow.json — Node Graph

### Node Format

```json
{
  "nodeId": {
    "inputs": {
      "staticField": "value",
      "connectedField": ["sourceNodeId", outputIndex]
    },
    "class_type": "NodeClassName",
    "_meta": { "title": "Display Title" }
  }
}
```

- **Connections** use `["nodeId", outputIndex]` where outputIndex is 0-based
- **Subgraph node IDs** use `"subgraphId:nodeId"` format (e.g., `"213:191"` = subgraph 213, node 191)
- Node IDs are strings, even when numeric

### AppInfo Node (Required)

Every workflow needs an AppInfo node to expose inputs/outputs to GT:

```json
{
  "appInfoNodeId": {
    "inputs": {
      "name": "Mixlab-App",
      "input_ids": "2,6,7",
      "output_ids": "3",
      "description": "",
      "version": 1,
      "share_prefix": "",
      "link": "https://",
      "category": "",
      "auto_save": "enable",
      "idle_animation": false,
      "AppInfoRun": <appInfoNodeId or null>,
      "image": ["emptyImageNodeId", 0]
    },
    "class_type": "AppInfo"
  }
}
```

**CRITICAL**: `input_ids` is a CSV string of node IDs that determines which nodes appear in the UI. A node will NOT show up in the UI unless it's listed here (even if it has node_parsers configured in params.json). Always include control nodes (IntNumber, FloatSlider, etc.) in input_ids.

Every workflow also needs an `EmptyImage` node connected to AppInfo's `image` input (for display purposes):

```json
{
  "emptyImageNodeId": {
    "inputs": { "width": 512, "height": 512, "batch_size": 1, "color": 0 },
    "class_type": "EmptyImage"
  }
}
```

### Control Node Types

Use these dedicated nodes when you need user-adjustable values. They auto-render in the UI when listed in AppInfo `input_ids`.

| Node Class | Fields | Use For | UI Rendering |
|---|---|---|---|
| `IntNumber` | `number, min_value, max_value, step` | Integer sliders | Slider (auto via default parser) |
| `FloatSlider` | `number, min_value, max_value, step` | Float sliders | Slider with acceptFloat (auto) |
| `PrimitiveString` | `value` | String constants, select dropdowns | Text field (override with select in params.json) |
| `PrimitiveBoolean` | `value` | On/off toggles | Checkbox (auto) |
| `PrimitiveFloat` | `value` | Float constants (not user-facing) | Number input |
| `TextInput_` | `text` | Text prompts | TextArea (auto, multi-line) |
| `Seed (rgthree)` | `seed` | Seed input (-1 = random) | Number input |

**Default node parsers** are automatically applied for `IntNumber`, `FloatSlider`, `LoadImage`, `LoadVideo`, `TextInput_`, `CLIPTextEncode`, and others — see `.cursor/rules/workflow-studio.mdc` for the full list. You only need custom node_parsers to override defaults.

### Output Nodes

| Node Class | Use For | Notes |
|---|---|---|
| `SaveImageWebsocket` | Image output | Preferred for GT — streams in real-time |
| `SaveImage` | Image output (file) | Saves to disk, GT reads from file |
| `SaveVideo` | Video output | Requires `filename_prefix`, `format`, `codec` |
| `CreateVideo` | Reassemble video | Combines frames + fps + audio before SaveVideo |

### Common Processing Patterns

#### Image Workflow
```
LoadImage → [Processing] → SaveImageWebsocket
```

#### Video Workflow
```
LoadVideo → GetVideoComponents → [Processing] → CreateVideo → SaveVideo
```

**GetVideoComponents outputs:**
- Index 0: frames (IMAGE batch)
- Index 1: audio
- Index 2: fps

Always preserve fps and audio through video workflows:
```json
"createVideoNode": {
  "inputs": {
    "images": ["processingNode", 0],
    "fps": ["getVideoComponentsNode", 2],
    "audio": ["getVideoComponentsNode", 1]
  },
  "class_type": "CreateVideo"
}
```

#### Txt2Img + Img2Img Switch Pattern
Uses a `Switch latent [Crystools]` to choose between empty latent (txt2img) and VAEEncoded input image (img2img):

```json
"latentSwitch": {
  "inputs": {
    "boolean": ["denoiseBooleanNode", 0],
    "on_true": ["vaeEncodeNode", 0],
    "on_false": ["emptyLatentNode", 0]
  },
  "class_type": "Switch latent [Crystools]"
}
```

#### RepeatLatentBatch for "Number of Images"
When a "Number of Images" control must work in BOTH txt2img and img2img modes, insert RepeatLatentBatch AFTER the latent switch (not inside EmptySD3LatentImage's batch_size, which only affects the txt2img path):

```json
"repeatNode": {
  "inputs": {
    "samples": ["latentSwitchNode", 0],
    "amount": ["numberOfImagesIntNode", 0]
  },
  "class_type": "RepeatLatentBatch"
}
```

Connect RepeatLatentBatch output → SetLatentNoiseMask → KSampler.

---

## 2. params.json — UI Configuration

### Minimal Structure

```json
{
  "parser": "comfyui",
  "process": "<COMFYUI>",
  "main": "",
  "description": "Workflow description",
  "category": "General",
  "comfyui_config": {
    "serverUrl": "http://127.0.0.1:8188",
    "workflow": "./workflow.json",
    "node_parsers": {
      "input_nodes": { }
    }
  },
  "icon": "./icon.jpg",
  "timeout": 300
}
```

### Optional Top-Level Fields

| Field | Type | Notes |
|---|---|---|
| `label` | string | Override display name |
| `executionName` | string | Custom execute button text (e.g., "Generate") |
| `tags` | string[] | For search/filtering |
| `order` | number | Sort order within category |
| `devMode` | boolean | Only visible in dev mode |
| `timeout` | number | Seconds before timeout |
| `iconBadge` | object | Badge on workflow card (`content`, `colorVariant`, + CSS) |

### comfyui_config Fields

| Field | Type | Notes |
|---|---|---|
| `serverUrl` | string or string[] | ComfyUI server URL(s). Supports `<globalEnv.varName>` |
| `workflow` | string | Path to workflow.json (relative to workflow folder) |
| `parser_type` | string | Use `"mixlab"` for AppInfo-based layout with subgraphs |
| `hiddenNodeIds` | string[] | Hide nodes from UI (can be shown conditionally via connectTo) |
| `wrappedNodeIds` | string[] | Make subgraph groups collapsible (collapsed by default) |
| `nonPersistentNodeIds` | string[] | Don't persist these nodes' values between runs |
| `subgraphs` | object | Configure subgraph accordion groups |
| `node_parsers` | object or string | Inline config or path to external JSON file |
| `outputComparator` | object | Enable before/after wipe comparison |
| `saveInputPath` | string | Required when using uploadImage/uploadVideo |

### parser_type: "mixlab" vs Default

- **Default** (no `parser_type`): Simple workflows. AppInfo `input_ids` determines visible nodes. node_parsers customize how they render.
- **`"mixlab"`**: Complex workflows with subgraphs. Enables `wrappedNodeIds`, `subgraphs` config, accordion groups.

Both require nodes to be in AppInfo `input_ids` to appear.

### node_parsers — Customizing Node Inputs

```json
{
  "node_parsers": {
    "input_nodes": {
      "nodeId": {
        "connectTo": { ... },
        "inputs": {
          "fieldName": { "type": "...", ...config },
          "hiddenField": false,
          "connectionField": false
        }
      }
    }
  }
}
```

**Keys** can be specific node IDs (`"4"`, `"213:191"`) or class types (`"TextInput_"`, `"LoadImage"`). Specific IDs take precedence.

**Hiding fields**: Set to `false` to hide. Always hide connection fields (`"images": false`) and internal fields (`"resize_type": false`) on processing nodes that are exposed in input_ids.

### Input Types Reference

#### uploadImage
```json
{
  "type": "uploadImage",
  "imageSize": "500px",
  "accept": "<ACCEPTED_IMG_FORMATS>",
  "required": true,
  "drawMaskEnable": true,
  "maskNode": { "nodeId": "maskNodeId" },
  "instructions": "Draw on the area to edit",
  "base64": false,
  "cover": false
}
```

#### uploadVideo
```json
{
  "type": "uploadVideo",
  "accept": "<ACCEPTED_VIDEO_FORMATS>",
  "path": "<SAVE_INPUT_PATH>",
  "required": true
}
```

#### slider (inline on processing nodes)
```json
{
  "type": "slider",
  "min": 1,
  "max": 4,
  "step": 0.5,
  "default": 2,
  "acceptFloat": true,
  "label": "Scale Multiplier"
}
```

For IntNumber/FloatSlider nodes, the default parser auto-creates sliders using reference strings (`"min": "min_value"`, etc.) — you usually don't need custom config for these.

#### select
```json
{
  "type": "select",
  "options": [
    "SimpleString",
    { "value": "val", "label": "Display Label" },
    { "value": "val", "label": "Label", "image": { "name": "select/img.jpg", "size": 32 } },
    { "value": "/services/plugins-backend/api/custom/user/loras/qwen?includePath=true", "fetchUrl": true }
  ],
  "default": "SimpleString",
  "label": "Choose Option"
}
```

#### checkbox
```json
{ "type": "checkbox", "label": "Enable Feature" }
```

#### textArea / textField
```json
{ "type": "textArea" }
{ "type": "textField", "label": "Name" }
```

#### number
```json
{ "type": "number", "min": 0, "max": 100, "step": 1, "acceptFloat": false }
```

### connectTo — Conditional Visibility (Node Level)

Controls when an entire node is shown/hidden based on another node's field:

```json
{
  "nodeId": {
    "connectTo": {
      "nodeId": "controlNodeId",
      "inputField": "value",
      "conditions": [
        { "displayedWhen": true },
        { "hiddenWhen": false }
      ]
    },
    "inputs": { ... }
  }
}
```

- `displayedWhen`: Show node when field equals this value (use with `hiddenNodeIds`)
- `hiddenWhen`: Hide node when field equals this value

### connectTo — Auto-Update Values (Field Level)

Automatically sets a field's value when another node's field changes:

```json
{
  "inputs": {
    "text": {
      "type": "textArea",
      "connectTo": {
        "nodeId": "presetNode",
        "inputField": "value",
        "conditions": [
          { "whenValue": 0, "value": "" },
          { "whenValue": 1, "value": "Preset prompt text here" }
        ]
      }
    }
  }
}
```

### Subgraphs Configuration

Groups nodes into collapsible accordion sections (requires `parser_type: "mixlab"`):

```json
{
  "wrappedNodeIds": ["211", "220", "212"],
  "subgraphs": {
    "211": {
      "label": "LoRAs",
      "hideNodeLabels": false,
      "nodesOrder": ["157", "161", "156", "160"]
    },
    "212": {
      "label": "Denoise (Img2img)",
      "hideNodeLabels": ["212:197"]
    }
  }
}
```

- `nodesOrder` uses child IDs only (after the `:`)
- `hideNodeLabels`: `true` (hide all), `false` (show all), or array of specific node IDs
- `showNodeLabels`: takes precedence over hideNodeLabels

### Output Comparator

Enable before/after wipe comparison:

```json
{
  "outputComparator": {
    "defaultEnabled": false,
    "inputNodeId": "imageInputNodeId"
  }
}
```

---

## 3. Adding Mask Support to an Image Input

### Standard Pattern (core nodes only, no resize)

Most workflows use 3 nodes — no resize needed:

```
[LoadImage mask] → [ImageToMask] → [SetLatentNoiseMask] → [KSampler]
```

1. **LoadImage** (mask placeholder): Loads `"empty.png"`, hidden in UI, receives mask data when user draws
2. **ImageToMask**: Converts mask image red channel to mask tensor
3. **SetLatentNoiseMask**: Applies mask to latent, inserted between existing latent source and KSampler

```json
"MASK_ID": {
  "inputs": { "image": "empty.png" },
  "class_type": "LoadImage",
  "_meta": { "title": "Image Name (mask)" }
},
"MASK_TO_ID": {
  "inputs": { "channel": "red", "image": ["MASK_ID", 0] },
  "class_type": "ImageToMask",
  "_meta": { "title": "Convert Image to Mask" }
},
"SET_MASK_ID": {
  "inputs": {
    "samples": ["EXISTING_LATENT_NODE", 0],
    "mask": ["MASK_TO_ID", 0]
  },
  "class_type": "SetLatentNoiseMask",
  "_meta": { "title": "Set Latent Noise Mask" }
}
```

### Optional: Mask Resize (when mask dimensions must match)

When the mask needs to match a specific image's dimensions, use `ResizeImageMaskNode` with `"match size"` (preferred over custom nodes like JWMaskResize):

```json
"RESIZE_ID": {
  "inputs": {
    "resize_type": "match size",
    "resize_type.crop": "disabled",
    "scale_method": "area",
    "input": ["MASK_LOAD_IMAGE_ID", 0],
    "resize_type.match": ["TARGET_IMAGE_NODE", 0]
  },
  "class_type": "ResizeImageMaskNode",
  "_meta": { "title": "Resize Image/Mask" }
}
```

Insert before ImageToMask: `LoadImage → ResizeImageMaskNode → ImageToMask → ...`

### AppInfo Changes
Add mask LoadImage node ID to `input_ids` so the system can send mask data to it.

### params.json Changes

1. Add mask node to `hiddenNodeIds` (user interacts via draw UI, not directly)
2. Enable mask drawing on the image input:
```json
{
  "imageNodeId": {
    "inputs": {
      "image": {
        "type": "uploadImage",
        "drawMaskEnable": true,
        "maskNode": { "nodeId": "maskLoadImageNodeId" }
      }
    }
  }
}
```

### How Masks Work
- Default: `empty.png` (white) → red channel = 1.0 everywhere → full noise = no masking
- User draws: white areas = regenerate, black areas = preserve original

### Reference Implementations
| Workflow | Mask Node | Image Node | Pattern |
|---|---|---|---|
| Image Edit (Qwen) | 228:228 | 228:78 | Simple (no resize) |
| Paint Transfer | 266 | 264 | Simple (no resize) |
| UI Screen Restyle | 233 | 18 | Simple (no resize) |
| Extract Materials | 122 | 41 | With ResizeImageMaskNode match size |
| Apply Vinyl Wrap | 57 | 56 | With auto-mask (SegmentAnything) |

---

## 4. Common Tasks Cookbook

### Adding a Slider to a Processing Node

When the processing node has inputs you want to expose (e.g., scale, quality), you have two options:

**Option A: Inline via node_parsers** (simpler, when the node accepts direct values)
1. Add the processing node to AppInfo `input_ids`
2. In params.json node_parsers, hide internal fields (`false`) and override visible ones with slider/select types
3. Hide connection fields (`"images": false`, `"video": false`)

```json
"1": {
  "inputs": {
    "resize_type": false,
    "images": false,
    "resize_type.scale": { "type": "slider", "min": 1, "max": 4, "step": 0.5, "label": "Scale" },
    "quality": { "type": "select", "options": ["PERFORMANCE", "BALANCED", "QUALITY", "ULTRA"], "default": "ULTRA" }
  }
}
```

**Option B: Separate control node** (when you need a dedicated UI widget)
1. Add an `IntNumber` or `FloatSlider` node to workflow.json
2. Connect its output to the processing node's input: `"field": ["controlNodeId", 0]`
3. Add the control node to AppInfo `input_ids`
4. No params.json changes needed — default parsers handle it

### Converting an Image Workflow to Video

1. Replace `LoadImage` with `LoadVideo` + `GetVideoComponents`
2. Feed `GetVideoComponents` output 0 (frames) to processing node instead of LoadImage
3. Replace `SaveImageWebsocket` with `CreateVideo` + `SaveVideo`
4. Wire `GetVideoComponents` outputs: fps (index 2) and audio (index 1) into `CreateVideo`
5. Update params.json: change `uploadImage` to `uploadVideo` (or rely on default LoadVideo parser)
6. Hide `video-preview` field: `"loadVideoNodeId": { "inputs": { "video-preview": false } }`

### Setting Up a Workflow from a ComfyUI Export

When the user provides a raw ComfyUI API-format JSON export, follow these steps:

1. **Create folder** `data/gt-workflows/<Workflow Name>/`
2. **Clean up the workflow JSON:**
   - Replace real filenames with `placeholder.jpeg` (images) or `placeholder.mp4` (videos)
   - Replace `SaveImage` output with `SaveImageWebsocket` for GT streaming (keep SaveImage too if desired)
   - Verify AppInfo `output_ids` points to the SaveImageWebsocket node
   - Verify AppInfo `input_ids` includes ALL user-facing nodes — subgraph IDs (e.g., `"132"`) cover all child nodes in that subgraph
   - If there's no AppInfo node, add one along with an EmptyImage node
3. **Recognize subgraph nodes:** Exported subgraph nodes use `"subgraphId:childId"` format (e.g., `"132:129"`). In params.json, configure the parent subgraph ID in `wrappedNodeIds` and `subgraphs` for proper accordion grouping. Use `nodesOrder` with child IDs only (the part after `:`).
4. **Create params.json** with the appropriate config (see minimal structure above)
5. **Add an icon** (icon.jpg or similar)

### Adding a New Option to an Existing Select

In params.json, find the select definition and add to the `options` array. For dynamic options from backend, use `fetchUrl`:
```json
{ "value": "/services/plugins-backend/api/custom/user/loras/model?includePath=true", "fetchUrl": true }
```

### Debugging: Node Not Showing in UI

1. Check AppInfo `input_ids` — the node must be listed there
2. Check `hiddenNodeIds` — make sure it's not hidden (unless intentionally with connectTo displayedWhen)
3. Check connectTo conditions — the controlling node's value might be hiding it
4. Verify JSON is valid — use `python -m json.tool workflow.json`

### Debugging: Slider/Select Not Rendering

1. Verify the node is in AppInfo `input_ids`
2. Check that node_parsers key matches the exact node ID (string, e.g., `"1"` not `1`)
3. For inline sliders on processing nodes: make sure to hide connection fields (`"images": false`)
4. Default parsers auto-handle IntNumber/FloatSlider — check if custom config conflicts

---

## 5. Global Environment & Server Config

- `serverUrl` supports `<globalEnv.varName>` references resolved by backend
- Array `serverUrl` enables load balancing (backend picks lowest-queue server)
- `comfyui_config.serverUrl` is `string | string[]` — use `getPrimaryServerUrl()` from `@/utils/serverUrl` in code
- On download/export, serverUrl is neutralized to prevent leaking internal URLs

---

## 6. Checklist for New Workflows

- [ ] Create folder `data/gt-workflows/<Name>/`
- [ ] Create `workflow.json` with all nodes, AppInfo, and EmptyImage
- [ ] Verify `input_ids` includes ALL user-facing nodes (image/video inputs AND control nodes)
- [ ] Verify `output_ids` points to correct output node
- [ ] Create `params.json` with parser, serverUrl, workflow path, node_parsers
- [ ] Hide internal/connection fields with `false` in node_parsers
- [ ] Add `icon.jpg`
- [ ] Set appropriate `timeout` (120s for simple, 300-500s for heavy)
- [ ] Test: all inputs render, values propagate, workflow executes
- [ ] Validate JSON: `python -m json.tool workflow.json && python -m json.tool params.json`
