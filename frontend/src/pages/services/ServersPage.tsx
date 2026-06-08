import { type NavigateFn } from './serverHelpers'
import { ServersPage as _ServersPage } from '../_shared/ServersPage'
import { kindBoundComponents } from '../_shared/kindBoundComponents'

const DETAIL_COMPONENTS = kindBoundComponents('service')

/** Services listing page — thin wrapper around the shared ServersPage with
 *  kindLabel="service" and services-flavoured Overview/Settings/Actions
 *  injected for the detail view. */
export function ServersPage({ navigate }: { navigate?: NavigateFn }) {
  return (
    <_ServersPage navigate={navigate} kindLabel="service" detailComponents={DETAIL_COMPONENTS} />
  )
}
