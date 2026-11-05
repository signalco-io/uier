import { MAX_NAME_LENGTH, MAX_WORKSPACE_NAME_LENGTH } from './limits';

// The first-run step (`/app/welcome`): a new account confirms its name and its workspace's name once.
// Pure suggestions only, so the page and the tests share them.

/** Mail providers whose domain says nothing about where someone works */
const personalDomains = new Set([
    'gmail.com', 'googlemail.com', 'icloud.com', 'me.com', 'mac.com', 'msn.com', 'ymail.com', 'rocketmail.com',
    'proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me', 'mail.com', 'email.com', 'zoho.com', 'zohomail.com',
    'fastmail.com', 'fastmail.fm', 'hey.com', 'tutanota.com', 'tutanota.de', 'tuta.io', 'tuta.com', 'duck.com',
    'mailbox.org', 'posteo.de', 'posteo.net', 'hushmail.com', 'qq.com', '163.com', '126.com', 'yeah.net', 'sina.com',
    'naver.com', 'hanmail.net', 'daum.net', 'web.de', 't-online.de', 'freenet.de', 'mail.ru', 'inbox.ru', 'list.ru',
    'bk.ru', 'ya.ru', 'rambler.ru', 'seznam.cz', 'centrum.cz', 'wp.pl', 'o2.pl', 'interia.pl', 'onet.pl', 'libero.it',
    'virgilio.it', 'tiscali.it', 'laposte.net', 'orange.fr', 'free.fr', 'sfr.fr', 'wanadoo.fr', 'btinternet.com',
    'sky.com', 'virginmedia.com', 'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'cox.net', 'charter.net',
    'rediffmail.com', 'abv.bg', 'net.hr', 't-com.hr', 'inet.hr', 'gmx.net', 'gmx.de', 'gmx.at', 'gmx.ch'
]);

/** Providers with a domain per country (`yahoo.co.uk`, `outlook.de`, `gmx.com`): matched by their first label */
const personalProviders = new Set(['outlook', 'hotmail', 'live', 'yahoo', 'aol', 'gmx', 'yandex', 'windowslive']);

/** Second-level labels of country domains (`acme.co.uk`), skipped to reach the organization's own label */
const countrySecondLevels = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'ltd', 'plc', 'or', 'ne', 'go']);

function capitalize(word: string) {
    return word.charAt(0).toLocaleUpperCase() + word.slice(1);
}

/** Whether an email is at a webmail or other personal mail provider (`gmail.com`, `outlook.de`, ...) */
export function isPersonalEmailDomain(domain: string) {
    const normalized = domain.toLowerCase().replace(/\.$/, '');
    return personalDomains.has(normalized) || personalProviders.has(normalized.split('.')[0] ?? '');
}

/** `maya.tester+uier@example.com` -> `Maya Tester` */
export function nameFromEmail(email: string) {
    const local = email.split('@')[0]?.split('+')[0] ?? '';
    const name = local.split(/[._-]+/).filter(Boolean).map(capitalize).join(' ');
    return (name || local || email).slice(0, MAX_NAME_LENGTH);
}

/** `maya@acme-studio.co.uk` -> `Acme Studio`; nothing for webmail (`maya@gmail.com`) */
export function workspaceNameFromEmail(email: string) {
    const domain = email.split('@')[1]?.toLowerCase().replace(/\.$/, '');
    if (!domain || isPersonalEmailDomain(domain))
        return undefined;
    const labels = domain.split('.').filter(Boolean);
    // An IP address or a single label says nothing either
    if (labels.length < 2 || labels.every(label => /^\d+$/.test(label)))
        return undefined;
    labels.pop();
    if (labels.length > 1 && countrySecondLevels.has(labels.at(-1)!))
        labels.pop();
    const name = labels.at(-1)?.split('-').filter(Boolean).map(capitalize).join(' ');
    return name ? name.slice(0, MAX_WORKSPACE_NAME_LENGTH) : undefined;
}

/** A workspace of one person: `Maya’s workspace` */
export function personalWorkspaceName(name: string) {
    const first = name.trim().split(/\s+/)[0];
    return (first ? `${first}’s workspace` : 'My workspace').slice(0, MAX_WORKSPACE_NAME_LENGTH);
}
