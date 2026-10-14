/**
 * Strip HTML tags from user-supplied text before sending to backend.
 * Prevents stored XSS if content is ever rendered outside a React context
 * (e.g. SES emails, logs, third-party dashboards).
 */
export function stripHtml(s) {
  return (s || '').replace(/<[^>]*>/g, '').trim();
}
