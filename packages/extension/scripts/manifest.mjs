export function createManifest({ browser, api, version }) {
    if (!['chrome', 'firefox'].includes(browser)) throw new Error('Unknown browser target.');
    return {
        manifest_version: 3, name: 'uier', version,
        ...(browser === 'chrome' ? { minimum_chrome_version: '120' } : {}),
        description: 'Review configured project sites with uier. Signed-in project membership required.',
        permissions: ['activeTab', 'scripting', 'storage', 'identity'],
        host_permissions: [`${api}/*`],
        background: browser === 'chrome' ? { service_worker: 'worker.js', type: 'module' }
            : { scripts: ['worker.js'], persistent: false },
        action: { default_popup: 'popup.html', default_title: 'uier' },
        commands: { _execute_action: { suggested_key: { default: 'Alt+Shift+U' }, description: 'Open uier' } },
        icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
        content_security_policy: { extension_pages: `script-src 'self'; object-src 'none'; frame-src ${api}; connect-src ${api}; style-src 'self' 'unsafe-inline'; img-src 'self' data:;` },
        ...(browser === 'firefox' ? { browser_specific_settings: { gecko: {
            id: 'uier@signalco.io', strict_min_version: '153.0',
            data_collection_permissions: { required: ['authenticationInfo', 'browsingActivity', 'websiteContent', 'personallyIdentifyingInfo', 'personalCommunications'] }
        } } } : {})
    };
}
