import { brand } from '@uier/brand';
import type { EmailMessage } from './send';

// Plain, brand-styled emails: email clients don't load CSS variables or web fonts, so the colours
// come from the hex mirrors in @uier/brand and the font stack falls back to the system font.

function escapeHtml(value: string) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll('\'', '&#39;');
}

type Layout = {
    to: string;
    subject: string;
    /** Paragraphs before the button */
    paragraphs: string[];
    action: { label: string; url: string };
    /** Small print after the button */
    footnote: string;
    footerAction?: { label: string; url: string };
};

export function layoutEmail({ to, subject, paragraphs, action, footnote, footerAction }: Layout): EmailMessage {
    const { colors } = brand;
    const font = 'Geist, system-ui, -apple-system, \'Segoe UI\', sans-serif';
    const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px;background:${colors.ink100};font-family:${font};color:${colors.ink};">
<div style="max-width:480px;margin:0 auto;background:${colors.paper};border:1px solid ${colors.ink200};border-radius:16px;padding:32px;">
<p style="margin:0 0 24px;font-size:18px;font-weight:600;letter-spacing:-0.03em;">${escapeHtml(brand.name)}</p>
${paragraphs.map(p => `<p style="margin:0 0 16px;font-size:16px;line-height:26px;">${escapeHtml(p)}</p>`).join('\n')}
<p style="margin:24px 0;"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:${colors.ink};color:${colors.paper};text-decoration:none;font-weight:500;font-size:16px;padding:10px 18px;border-radius:10px;">${escapeHtml(action.label)}</a></p>
<p style="margin:0 0 8px;font-size:14px;line-height:21px;color:${colors.ink500};">If the button does not work, open this link:<br><a href="${escapeHtml(action.url)}" style="color:${colors.accent};word-break:break-all;">${escapeHtml(action.url)}</a></p>
<p style="margin:16px 0 0;font-size:14px;line-height:21px;color:${colors.ink500};">${escapeHtml(footnote)}</p>
${footerAction ? `<p><a href="${escapeHtml(footerAction.url)}" style="color:${colors.accent};">${escapeHtml(footerAction.label)}</a></p>` : ''}
</div>
</body>
</html>`;

    const text = [
        ...paragraphs,
        `${action.label}: ${action.url}`,
        footnote,
        ...(footerAction ? [`${footerAction.label}: ${footerAction.url}`] : []),
        `${brand.name} · ${brand.url}`
    ].join('\n\n');

    return { to, subject, text, html };
}

export function invitationEmail({ to, url, inviterName, inviterEmail, projectName, role, teamAccess = false }: {
    to: string;
    url: string;
    inviterName: string;
    inviterEmail: string;
    projectName?: string;
    role: 'admin' | 'commenter';
    teamAccess?: boolean;
}) {
    const what = projectName ? projectName : 'their projects';
    return layoutEmail({
        to,
        subject: projectName ? `Review ${projectName} on ${brand.name}` : `Join ${inviterName} on ${brand.name}`,
        paragraphs: [
            `${inviterName} (${inviterEmail}) invited you to review ${what} on ${brand.name}${role === 'admin' ? ', as an admin' : ''}.`,
            ...(teamAccess ? ["Your teams grant access to their current selected projects. Workspace admins can change those projects later. Teams and direct projects add together."] : []),
            `${brand.name} lets you leave comments directly on the site. Accepting signs you in as ${to}${projectName ? ' and opens the site with the toolbar' : ''}.`
        ],
        action: { label: 'Accept invitation', url },
        footnote: 'The link works once and expires in 7 days. If you did not expect this invitation, ignore this email.'
    });
}

export function signInEmail({ to, url, code }: { to: string; url: string; code: string }) {
    return layoutEmail({
        to,
        subject: `Sign in to ${brand.name}`,
        paragraphs: [
            `Your sign-in code: ${code}`,
            `Type it only in the browser where you asked to sign in to ${brand.name} as ${to}. Never share this code.`,
            'The code and link work once and expire together in 15 minutes. You can also use the link below.'
        ],
        action: { label: 'Sign in', url },
        footnote: 'If you did not ask to sign in, ignore this email.'
    });
}

export function notificationVerificationEmail({ to, url }: { to: string; url: string }) {
    return layoutEmail({ to, subject: 'Confirm reply notifications on uier',
        paragraphs: ['Confirm this address to receive replies and status changes for the thread you chose. Commenting does not require email or an account.'],
        action: { label: 'Confirm reply notifications', url },
        footnote: 'This link expires in 24 hours. If you did not request it, ignore this email. Every digest includes an unsubscribe link.' });
}
