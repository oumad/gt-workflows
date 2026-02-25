/**
 * Format a user identifier for anonymised display: first letter + **.** + last letter.
 * Shared for both admin and guest views (e.g. job stats "Who's using").
 */
export function anonymiseUserName(userId: string): string {
  if (!userId) return '**.**'
  const first = userId[0] ?? ''
  const last = userId.length > 1 ? userId[userId.length - 1] : first
  return `${first}**.**${last}`
}
