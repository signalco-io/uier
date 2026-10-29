import { brand } from '@uier/brand';
import type { EmailMessage } from './send';

// Brand-styled emails for light and dark clients. Email clients load no CSS variables or web
// fonts, so the colours come from the hex mirrors in @uier/brand and Geist falls back to the
// system font. Everything that matters is inline on tables, which every client keeps; the <style>
// blocks only add dark mode and small screens on top:
// - `color-scheme` and `prefers-color-scheme` give Apple Mail, Outlook for Mac and iOS and others
//   the brand's dark theme (black page, surface card, white button);
// - `[data-ogsb]` / `[data-ogsc]` do the same in Outlook.com, which marks what it recolours;
// - clients that recolour emails themselves (Gmail apps) get ink on paper, which inverts cleanly.
// Each block stands alone: Gmail drops a whole <style> block over one rule it does not support.

const { colors, radius } = brand;
const WIDTH = 520;
/** The app icon (white mark on a black plate) reads on light and dark cards; clients never invert images. */
const ICON_URL = `${brand.url}/apple-touch-icon.png`;
const sans = `${brand.fonts.sans}, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
const mono = `'${brand.fonts.mono}', ui-monospace, 'SF Mono', Menlo, Consolas, monospace`;

const light = {
    page: colors.ink100, card: colors.paper, border: colors.ink200, code: colors.ink100,
    heading: colors.ink, text: colors.ink700, muted: colors.ink500, link: colors.accent,
    button: colors.ink, buttonText: colors.paper
};

/** Class → declarations for dark mode. Backgrounds and text colours are split for Outlook.com's markers. */
const darkBackgrounds = {
    'u-page': `background-color:${colors.black}`,
    'u-card': `background-color:${colors.ink};border-color:${colors.darkBorder}`,
    'u-code': `background-color:${colors.darkElevated};border-color:${colors.darkBorder}`,
    'u-rule': `border-color:${colors.darkBorder}`,
    // Solid buttons are white on dark
    'u-button': `background-color:${colors.paper};color:${colors.ink}`
};
const darkColors = {
    'u-heading': `color:${colors.darkText}`,
    'u-text': `color:${colors.ink300}`,
    'u-muted': `color:${colors.darkMuted}`,
    'u-link': `color:${colors.accentOnDark}`
};

function rules(prefix: string, declarations: Record<string, string>) {
    return Object.entries(declarations)
        .map(([name, block]) => `${prefix}.${name}{${block.split(';').map(declaration => `${declaration}!important`).join(';')}}`)
        .join('');
}

const baseCss = 'body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}'
    + 'img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}'
    + '@media only screen and (max-width:600px){.u-outer{padding:16px 8px!important}.u-card{padding:24px!important}'
    + '.u-footer{padding:16px 25px 0!important}.u-code-value{font-size:28px!important;line-height:36px!important}}';
const darkCss = ':root{color-scheme:light dark;supported-color-schemes:light dark}'
    + `@media (prefers-color-scheme:dark){${rules('', darkBackgrounds)}${rules('', darkColors)}}`;
const markerCss = rules('[data-ogsb] ', darkBackgrounds) + rules('[data-ogsc] ', darkColors)
    + 'a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;font-size:inherit!important;'
    + 'font-family:inherit!important;font-weight:inherit!important;line-height:inherit!important}';
const outlookCss = 'table,td,h1,p,a{font-family:\'Segoe UI\',Arial,sans-serif!important}.u-mono{font-family:Consolas,\'Courier New\',monospace!important}';

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
    /** The heading above the message; the subject when omitted */
    heading?: string;
    /** A one-time code, shown large before the paragraphs */
    code?: { label: string; value: string };
    /** Paragraphs before the button */
    paragraphs: string[];
    action: { label: string; url: string };
    /** Small print after the button */
    footnote: string;
    footerAction?: { label: string; url: string };
};

export function layoutEmail({ to, subject, heading = subject, code, paragraphs, action, footnote, footerAction }: Layout): EmailMessage {
    const url = escapeHtml(action.url);
    const linkStyle = `color:${light.link};text-decoration:underline;`;
    const smallPrint = [
        `If the button does not work, open this link:<br><a class="u-link u-mono" href="${url}" target="_blank" style="${linkStyle}font-family:${mono};font-size:13px;line-height:20px;word-break:break-all;">${url}</a>`,
        escapeHtml(footnote),
        ...(footerAction ? [`<a class="u-link" href="${escapeHtml(footerAction.url)}" target="_blank" style="${linkStyle}">${escapeHtml(footerAction.label)}</a>`] : [])
    ];
    const codeRow = code ? `<tr><td style="padding:8px 0 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="u-code" align="center" bgcolor="${light.code}" style="padding:20px 16px;background-color:${light.code};border:1px solid ${light.border};border-radius:${radius.card}px;text-align:center;">
<p class="u-muted" style="margin:0 0 4px;font-family:${sans};font-size:14px;line-height:21px;color:${light.muted};">${escapeHtml(code.label)}</p>
<p class="u-heading u-mono u-code-value" style="margin:0;font-family:${mono};font-size:32px;line-height:40px;font-weight:600;letter-spacing:0.16em;text-indent:0.16em;color:${light.heading};">${escapeHtml(code.value)}</p>
</td></tr></table>
</td></tr>` : '';

    const html = `<!doctype html>
<html lang="en" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><style>${outlookCss}</style><![endif]-->
<style>${baseCss}</style>
<style>${darkCss}</style>
<style>${markerCss}</style>
</head>
<body class="u-page" style="margin:0;padding:0;background-color:${light.page};">
<div role="article" aria-roledescription="email" aria-label="${escapeHtml(subject)}" lang="en" dir="ltr">
<table role="presentation" class="u-page" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${light.page}" style="background-color:${light.page};">
<tr><td class="u-outer" align="center" style="padding:40px 16px;">
<!--[if mso]><table role="presentation" align="center" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${WIDTH}px;margin:0 auto;">
<tr><td class="u-card" bgcolor="${light.card}" style="padding:32px;background-color:${light.card};border:1px solid ${light.border};border-radius:${radius.panel}px;text-align:left;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding:0 0 24px;"><img src="${ICON_URL}" width="32" height="32" alt="${brand.name}" style="display:block;width:32px;height:32px;border:0;border-radius:7px;font-family:${sans};font-size:14px;color:${light.muted};"></td></tr>
<tr><td><h1 class="u-heading" style="margin:0 0 16px;font-family:${sans};font-size:20px;line-height:26px;font-weight:600;letter-spacing:-0.015em;color:${light.heading};">${escapeHtml(heading)}</h1></td></tr>
${codeRow}
<tr><td>
${paragraphs.map(text => `<p class="u-text" style="margin:0 0 16px;font-family:${sans};font-size:16px;line-height:26px;color:${light.text};">${escapeHtml(text)}</p>`).join('\n')}
</td></tr>
<tr><td style="padding:8px 0 32px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="u-button" bgcolor="${light.button}" style="background-color:${light.button};border-radius:${radius.largeControl}px;mso-padding-alt:12px 20px;">
<a class="u-button" href="${url}" target="_blank" style="display:inline-block;padding:12px 20px;font-family:${sans};font-size:16px;line-height:20px;font-weight:500;color:${light.buttonText};background-color:${light.button};text-decoration:none;border-radius:${radius.largeControl}px;mso-padding-alt:0;">${escapeHtml(action.label)}</a>
</td></tr></table>
</td></tr>
<tr><td class="u-rule" style="padding:24px 0 0;border-top:1px solid ${light.border};">
${smallPrint.map((content, index) => `<p class="u-muted" style="margin:0 0 ${index === smallPrint.length - 1 ? 0 : 12}px;font-family:${sans};font-size:14px;line-height:21px;color:${light.muted};">${content}</p>`).join('\n')}
</td></tr>
</table>
</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${WIDTH}px;margin:0 auto;">
<tr><td class="u-footer u-muted" style="padding:24px 33px 0;font-family:${sans};font-size:12px;line-height:17px;color:${light.muted};text-align:left;">
<a class="u-muted u-mono" href="${brand.url}" target="_blank" style="font-family:${mono};color:${light.muted};text-decoration:none;">${brand.domain}</a> · ${escapeHtml(brand.tagline)}
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</div>
</body>
</html>`;

    const text = [
        ...(code ? [`${code.label}: ${code.value}`] : []),
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
        code: { label: 'Your sign-in code', value: code },
        paragraphs: [
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
