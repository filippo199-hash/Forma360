/**
 * Resolve a user's display name, preferring the structured first + last
 * name (To-Do #4) so surfaces like "Prepared by" and assignee chips always
 * show a full name. Falls back to the single `name` field, then the email.
 */
export function displayUserName(u: {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}): string {
  const first = u.firstName?.trim();
  const last = u.lastName?.trim();
  if (first && last) return `${first} ${last}`;
  if (u.name && u.name.trim() !== '') return u.name;
  if (first) return first;
  return u.email ?? '';
}
