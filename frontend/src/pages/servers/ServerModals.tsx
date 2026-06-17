import type { Server as ServerType } from '../../types'
import { AddServerModal as _AddServerModal } from '../_shared/ServerModals'

/** Hosts-flavoured add modal: host-only URL input (no port, no type — those
 *  belong to services running on the host). Internally posts a back-compat
 *  type='workflow' so the legacy /api/servers schema is satisfied. */
export function AddServerModal(props: {
  onClose: () => void
  onCreated: (s: ServerType) => void
  defaultUrl?: string
}) {
  return <_AddServerModal {...props} kindLabel="server" />
}
