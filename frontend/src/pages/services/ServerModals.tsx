import type { Server as ServerType } from '../../types'
import { AddServerModal as _AddServerModal } from '../_shared/ServerModals'

/** Services-flavoured add modal: registered-host picker + type toggle + port
 *  input. The URL is composed inside the shared component. */
export function AddServerModal(props: {
  onClose: () => void
  onCreated: (s: ServerType) => void
  defaultUrl?: string
  servers: ServerType[]
}) {
  return <_AddServerModal {...props} kindLabel="service" />
}
