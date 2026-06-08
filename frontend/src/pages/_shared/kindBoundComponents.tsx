import type { Server as ServerType, Workflow, NavigateFn } from '../../types'
import { type ServerPatch } from './serverHelpers'
import { ServerOverview } from './ServerOverviewTab'
import { ServerSettings, ServerActions } from './ServerSettingsTab'
import type { DetailComponents, KindLabel } from './ServerDetail'

/**
 * Per-kind binders for the shared detail components.
 *
 * The shared ServerDetail accepts a `components` prop with Overview/Settings/
 * Actions that don't know which flavour they're rendering — kindLabel is
 * passed by the wrapper. Previously this was done with four small per-kind
 * files (services/ServerOverviewTab.tsx, services/ServerSettingsTab.tsx, and
 * the matching pair under servers/). This factory replaces those wrappers
 * with one call: `kindBoundComponents('service'|'server')`.
 */
export function kindBoundComponents(kindLabel: KindLabel): DetailComponents {
  return {
    Overview: (props: {
      server: ServerType
      servers: ServerType[]
      wfs: Workflow[]
      isAdmin: boolean
      onPatch: (patch: ServerPatch) => Promise<void>
      navigate?: NavigateFn
    }) => <ServerOverview {...props} kindLabel={kindLabel} />,
    Settings: (props: { server: ServerType; onSave: (patch: ServerPatch) => Promise<void> }) => (
      <ServerSettings {...props} kindLabel={kindLabel} />
    ),
    Actions: (props: { server: ServerType; onDelete: () => void }) => (
      <ServerActions {...props} kindLabel={kindLabel} />
    ),
  }
}
