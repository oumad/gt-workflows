/**
 * Centralized HTTP error class used by every service layer.
 *
 * Services throw `HttpError` (or a subclass) with a status code and a stable
 * `code` string. Routes call `httpStatusForError()` / `httpErrorResponse()` to
 * translate to the wire format. This keeps HTTP concerns out of services
 * while giving every endpoint a uniform error envelope.
 */
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export class HttpError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

/** Sugar for the common cases — keeps `throw notFound('User')` readable. */
export const notFound = (what = 'Not found') => new HttpError(404, 'not_found', what)
export const badRequest = (msg: string) => new HttpError(400, 'bad_request', msg)
export const unauthorized = (msg = 'Unauthorized') => new HttpError(401, 'unauthorized', msg)
export const forbidden = (msg = 'Forbidden') => new HttpError(403, 'forbidden', msg)
export const conflict = (msg: string) => new HttpError(409, 'conflict', msg)
export const internalError = (msg = 'Internal error') => new HttpError(500, 'internal_error', msg)

/** Translate any caught error to `c.json({ error }, status)`. Unknown errors
 *  re-throw so Hono's global `onError` can log + 500 them. */
export function httpErrorResponse(c: Context, err: unknown): Response {
  if (err instanceof HttpError) {
    return c.json({ error: err.message, code: err.code }, err.status)
  }
  throw err
}
