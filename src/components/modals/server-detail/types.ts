export interface ServerSystemInfo {
  gpuName?: string
  vramTotal?: number
  vramFree?: number
  comfyVersion?: string
}

export interface LocalHealth {
  healthy: boolean
  latencyMs?: number
  systemInfo?: ServerSystemInfo
}
