import { Env } from './config';

// Comments publish immediately (D4), so the author has to hear about one
// without going to look. Resend's onboarding@resend.dev sender only delivers to
// the account owner, which is exactly this case and needs no custom domain.
export async function notifyNewComment(
  env: Env,
  comment: { id: string; slug: string; name: string; email: string | null; body: string }
): Promise<void> {
  const text = [
    `${comment.name} commented on ${comment.slug}`,
    comment.email ? `Reply-to: ${comment.email}` : 'No email given',
    '',
    comment.body,
    '',
    `Remove it from the admin page. Comment id: ${comment.id}`,
  ].join('\n');

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'onboarding@resend.dev',
        to: [env.ALERT_EMAIL],
        subject: `New comment on ${comment.slug}`,
        text,
      }),
    });
  } catch {
    // The alert is a convenience; the admin page is the backstop. A mail outage
    // must never cost a reader the comment they just wrote.
  }
}
