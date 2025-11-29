export interface WorkflowParams {
  process?: string | string[];
  main?: string;
  icon?: string;
  parser?: string;
  executionName?: string;
  description?: string;
  tags?: string[];
  order?: number;
  scope?: string;
  timeout?: number;
  devMode?: boolean;
  comfyui_config?: ComfyUIConfig;
  parameters?: Record<string, any>;
  ui?: Record<string, any>;
  use?: Record<string, any>;
  dashboard?: Record<string, any>;
  iconBadge?: IconBadge;
  documentation?: string;
  [key: string]: any;
}

export interface ComfyUIConfig {
  serverUrl: string;
  workflow: string;
  parser_type?: string;
  input_ids?: string[];
  output_ids?: string[];
  nonPersistentNodeIds?: string[];
  hiddenNodeIds?: string[];
  wrappedNodeIds?: string[];
  saveOutputPath?: string;
  node_parsers?: any;
  subgraphs?: Record<string, any>;
  placeholders?: Record<string, any>;
  ACCEPTED_FILE_FORMATS?: string[];
  ACCEPTED_IMG_FORMATS?: string[];
  ACCEPTED_VIDEO_FORMATS?: string[];
  ACCEPTED_AUDIO_FORMATS?: string[];
  SAVE_INPUT_PATH?: string;
}

export interface IconBadge {
  content: string;
  colorVariant?: 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success';
  [key: string]: any;
}

export interface Workflow {
  name: string;
  folderPath: string;
  params: WorkflowParams;
  workflowJson?: any;
  hasWorkflowFile: boolean;
  workflowFilePath?: string;
}

