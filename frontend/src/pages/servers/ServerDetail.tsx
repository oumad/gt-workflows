import type { Server as ServerType, Workflow, NavigateFn } from '../../types'
import { type ServerPatch } from './serverHelpers'
import { ServerDetail as _ServerDetail } from '../_shared/ServerDetail'
import { kindBoundComponents } from '../_shared/kindBoundComponents'

const DETAIL_COMPONENTS = kindBoundComponents('server')

/** Physical-server detail view — wraps the shared ServerDetail with the
 *  servers-flavored Overview/Settings/Actions sub-tabs and kindLabel="server". */
export function ServerDetail(props: {
  server: ServerType
  servers: ServerType[]
  wfs: Workflow[]
  isAdmin: boolean
  onBack: () => void
  onPatch: (patch: ServerPatch) => Promise<void>
  onDelete: () => void
  onRecheck: () => Promise<void>
  navigate?: NavigateFn
}) {
  return <_ServerDetail {...props} kindLabel="server" components={DETAIL_COMPONENTS} />
}
