export interface WorkflowParams {
  label?: string;
  process?: string | string[];
  main?: string;
  icon?: string;
  parser?: string;
  executionName?: string;
  description?: string;
  tags?: string[];
  category?: string;
  order?: number;
  scope?: string;
  timeout?: number;
  devMode?: boolean;
  forceLocal?: boolean;
  processArgs?: string[];
  /** snake_case by convention: matches the on-disk params.json field name used by the plugin. */
  comfyui_config?: ComfyUIConfig;
  parameters?: Record<string, ParameterConfig>;
  ui?: UIConfig;
  selectors?: UseConfig;
  dashboard?: DashboardConfig;
  iconBadge?: IconBadge;
  documentation?: string;
  [key: string]: unknown;
}

export interface ParameterConfig {
  type: 'textField' | 'selectMenu' | 'colorPicker' | 'slider' | 'checkbox' | 'fileDropZone' | 'numberInput';
  label?: string;
  required?: boolean;
  uiOnly?: boolean;
  persistenceType?: 'global' | 'local' | 'none';
  persistenceScope?: 'project' | 'app';
  default?: string | number | boolean;
  style?: Record<string, unknown>;
  subType?: 'folderPicker' | 'filePicker';
  selectOptions?: Array<string | number | SelectOption>;
  min?: number;
  max?: number;
  step?: number;
  hidden?: ConditionConfig;
  visible?: ConditionConfig;
  disabled?: ConditionConfig;
  active?: ConditionConfig;
  [key: string]: unknown;
}

export interface SelectOption {
  value: string | number;
  label?: string;
  image?: {
    name: string;
    size?: number;
  };
  fetchUrl?: boolean;
}

export interface ConditionConfig {
  _context?: 'item' | 'project';
  and?: Record<string, unknown>;
  or?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface UIConfig {
  [categoryName: string]: CategoryConfig;
}

export interface CategoryConfig {
  collapsible?: boolean;
  hideLabel?: boolean;
  rows: RowConfig[];
  visible?: ConditionConfig;
  hidden?: ConditionConfig;
}

export interface RowConfig {
  parameters?: string[];
  info?: InfoConfig;
}

export interface InfoConfig {
  text: string;
  colorVariant?: 'warn' | 'error' | 'success' | 'info' | 'debug' | string;
  fontWeight?: string;
  fontSize?: string;
  visible?: ConditionConfig;
  hidden?: ConditionConfig;
}

export interface SelectorsConfig {
  currentProject?: boolean | SelectorFieldConfig;
  appConfig?: boolean | SelectorFieldConfig;
  items?: boolean | ItemsSelectorConfig;
  selectedImages?: boolean | SelectorFieldConfig;
}

export interface SelectorFieldConfig {
  fields?: string[];
  objectTypeFields?: Record<string, string[]>;
}

export interface ItemsSelectorConfig extends SelectorFieldConfig {
  scope?: string | string[];
  includesScenes?: boolean | string[];
}

export interface DashboardConfig {
  disable?: boolean;
  breakSize?: number;
}

export interface PowerflowConnectionField {
  name: string;
  handleLabel?: string;
}

export interface PowerflowInputEntry {
  nodeId: string;
  fields: PowerflowConnectionField[];
}

export interface PowerflowOutputEntry {
  nodeId: string;
  handleLabel?: string;
}

export interface PowerflowConfig {
  enabled: boolean;
  exclusive?: boolean;
  availableConnections?: {
    inputs: PowerflowInputEntry[];
    outputs: PowerflowOutputEntry[];
  };
}

export interface ComfyUIConfig {
  serverUrl?: string | string[];
  workflow?: string;
  parser_type?: string;
  input_ids?: string[];
  output_ids?: string[];
  nonPersistentNodeIds?: string[];
  hiddenNodeIds?: string[];
  wrappedNodeIds?: string[];
  saveOutputPath?: string;
  node_parsers?: Record<string, unknown> | string;
  subgraphs?: Record<string, SubgraphConfig>;
  placeholders?: PlaceholdersConfig;
  outputComparator?: OutputComparatorConfig;
  powerflowConfig?: PowerflowConfig;
  skipOutputHistory?: boolean | string[];
}

export interface PlaceholdersConfig {
  ACCEPTED_FILE_FORMATS?: string[];
  ACCEPTED_IMG_FORMATS?: string[];
  ACCEPTED_VIDEO_FORMATS?: string[];
  ACCEPTED_AUDIO_FORMATS?: string[];
  [key: string]: unknown;
}

export interface SubgraphConfig {
  label?: string;
  hiddenNodes?: string[];
  hideNodeLabels?: boolean | string[];
  showNodeLabels?: boolean | string[];
  nodesOrder?: string[];
}

export interface OutputComparatorConfig {
  defaultEnabled?: boolean;
  inputNodeId?: string;
}

export interface IconBadge {
  content: string;
  colorVariant?: 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success';
  [key: string]: unknown;
}

/** ComfyUI workflow API format (node id -> node data). */
export type WorkflowJson = Record<string, unknown>;

export interface HistoryEntry {
  timestamp: string;
  iso: string;
  action: string;
  files: string[];
}

export interface Workflow {
  name: string;
  folderPath: string;
  params: WorkflowParams;
  workflowJson?: WorkflowJson;
  hasWorkflowFile: boolean;
  workflowFilePath?: string;
}
