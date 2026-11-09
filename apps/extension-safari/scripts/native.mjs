import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile, mkdir, mkdtemp, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { validate } from '@uier/extension-core/validate';
import { digest } from '@uier/extension-core/release';

export function appleVersion(value) {
    assert.match(value, /^\d{1,4}\.\d{1,2}\.\d{1,2}$/, 'Safari versions must fit CFBundleVersion');
    return value;
}
export function command(file, args, options = {}) {
    try { return execFileSync(file, args, options); }
    catch { throw new Error(`${file} failed; inspect the preceding tool output. No command is retried.`); }
}
async function find(directory, predicate, results = []) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, item.name);
        if (predicate(item.name)) results.push(path);
        else if (item.isDirectory() && !item.name.endsWith('.xcassets')) await find(path, predicate, results);
    }
    return results;
}
const plist = file => JSON.parse(command('plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' }));
async function writePlist(file, value) {
    command('plutil', ['-convert', 'xml1', '-o', file, '-'], { input: JSON.stringify(value) });
}
export function configureBundleIdentifiers(project) {
    const configured = new Set();
    for (const target of Object.values(project.objects)) {
        if (target.isa !== 'PBXNativeTarget') continue;
        const bundle = target.productType === 'com.apple.product-type.application' ? 'io.uier.safari'
            : target.productType === 'com.apple.product-type.app-extension' ? 'io.uier.safari.Extension' : undefined;
        if (!bundle) continue;
        const configurations = project.objects[target.buildConfigurationList].buildConfigurations;
        for (const id of configurations) project.objects[id].buildSettings.PRODUCT_BUNDLE_IDENTIFIER = bundle;
        configured.add(bundle);
    }
    assert.equal(configured.size, 2, 'Expected one generated containing app and Safari extension');
    return project;
}
async function selectXcode(env) {
    if (env.GITHUB_ACTIONS !== 'true') return;
    const candidates = (await readdir('/Applications')).filter(name => /^Xcode(?:_\d+(?:\.\d+)*)?\.app$/.test(name));
    const versions = candidates.map(name => {
        const directory = resolve('/Applications', name, 'Contents/Developer');
        const value = command('xcodebuild', ['-version'], { encoding: 'utf8', env: { ...env, DEVELOPER_DIR: directory } });
        const match = /^Xcode ([\d.]+)$/m.exec(value);
        return match && { directory, version: match[1].split('.').map(Number) };
    }).filter(Boolean).sort((a, b) => {
        for (let i = 0; i < 3; i++) { const difference = (b.version[i] ?? 0) - (a.version[i] ?? 0); if (difference) return difference; }
        return 0;
    });
    assert(versions[0], 'The macOS runner must include stable Xcode');
    env.DEVELOPER_DIR = versions[0].directory;
    console.log(`Using stable Xcode ${versions[0].version.join('.')}`);
}
export async function nativeArchive({ root, signed = false, env = process.env }) {
    assert.equal(process.platform, 'darwin', 'Safari native builds require macOS and full Xcode');
    await selectXcode(env);
    const { manifest, files } = await validate(undefined, { root, browser: 'safari' });
    const version = appleVersion(manifest.version);
    const generated = resolve(root, 'xcode/dist');
    try { await readdir(generated); }
    catch { command(process.execPath, [resolve(root, 'scripts/xcode.mjs')], { stdio: 'inherit' }); }
    const projects = await find(generated, name => name.endsWith('.xcodeproj'));
    assert.equal(projects.length, 1, 'Expected one generated Safari project');
    const project = projects[0], projectFile = resolve(project, 'project.pbxproj');
    // The converter can replace the final bundle-ID component with the app name. Normalize both
    // native targets before compiling, and before selecting profiles for signed distribution.
    await writePlist(projectFile, configureBundleIdentifiers(plist(projectFile)));
    const description = JSON.parse(command('xcodebuild', ['-list', '-json', '-project', project], { encoding: 'utf8' }));
    const schemes = description.project.schemes.filter(name => !/extension/i.test(name));
    assert.equal(schemes.length, 1, 'Expected one containing-app scheme');
    for (const file of await find(generated, name => name === 'Info.plist')) {
        const value = plist(file);
        const extension = Boolean(value.NSExtension);
        await writePlist(file, { ...value, CFBundleIdentifier: extension ? 'io.uier.safari.Extension' : 'io.uier.safari',
            CFBundleShortVersionString: version, CFBundleVersion: version,
            ...(!extension ? { LSApplicationCategoryType: 'public.app-category.developer-tools' } : {}) });
    }
    const out = resolve(root, 'release/native'); await mkdir(out, { recursive: true });
    const archive = resolve(out, `uier-${version}.xcarchive`);
    const temporary = await mkdtemp(join(tmpdir(), 'uier-safari-signing-'));
    const profiles = [];
    try {
        if (signed) {
            assert.equal(env.GITHUB_ACTIONS, 'true', 'Automated signing runs only in the protected CI environment');
            assert.match(env.APPLE_TEAM_ID ?? '', /^[A-Z0-9]{10}$/);
            assert(env.SAFARI_SIGNING_IDENTITY, 'Apple signing configuration is missing');
            const configured = {};
            for (const [bundle, secret] of [['io.uier.safari', 'SAFARI_APP_PROFILE_BASE64'], ['io.uier.safari.Extension', 'SAFARI_EXTENSION_PROFILE_BASE64']]) {
                assert(env[secret], `Missing ${secret}`);
                const file = resolve(temporary, `${bundle}.provisionprofile`);
                await writeFile(file, Buffer.from(env[secret], 'base64'), { mode: 0o600 });
                const decoded = JSON.parse(command('python3', ['-c', 'import plistlib,json,sys,datetime; p=plistlib.loads(sys.stdin.buffer.read()); print(json.dumps({"TeamIdentifier":p["TeamIdentifier"],"Entitlements":p["Entitlements"],"UUID":p["UUID"],"expires":p["ExpirationDate"].replace(tzinfo=datetime.timezone.utc).timestamp()}))'], {
                    input: command('security', ['cms', '-D', '-i', file]), encoding: 'utf8' }));
                assert.equal(decoded.TeamIdentifier[0], env.APPLE_TEAM_ID);
                assert.equal(decoded.Entitlements['com.apple.application-identifier'], `${env.APPLE_TEAM_ID}.${bundle}`);
                assert(decoded.expires * 1000 > Date.now(), 'Apple provisioning profile expired');
                configured[bundle] = decoded.UUID;
                for (const folder of ['Library/MobileDevice/Provisioning Profiles', 'Library/Developer/Xcode/UserData/Provisioning Profiles']) {
                    const target = resolve(env.HOME, folder, `${decoded.UUID}.provisionprofile`);
                    await mkdir(resolve(target, '..'), { recursive: true }); await copyFile(file, target); profiles.push(target);
                }
            }
            const value = plist(projectFile);
            const matched = new Set();
            for (const entry of Object.values(value.objects)) {
                const settings = entry.buildSettings;
                const bundle = settings?.PRODUCT_BUNDLE_IDENTIFIER;
                if (!configured[bundle]) continue;
                matched.add(bundle);
                Object.assign(settings, { CODE_SIGN_STYLE: 'Manual', DEVELOPMENT_TEAM: env.APPLE_TEAM_ID,
                    CODE_SIGN_IDENTITY: env.SAFARI_SIGNING_IDENTITY, PROVISIONING_PROFILE_SPECIFIER: configured[bundle] });
            }
            assert.equal(matched.size, 2, 'Generated app and extension bundle IDs must match their provisioning profiles');
            await writePlist(projectFile, value);
        }
        command('xcodebuild', ['-project', project, '-scheme', schemes[0], '-configuration', 'Release',
            '-destination', 'generic/platform=macOS', '-archivePath', archive,
            `MARKETING_VERSION=${version}`, `CURRENT_PROJECT_VERSION=${version}`,
            ...(signed ? [] : ['CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO']), 'archive'], { stdio: 'inherit' });
        const apps = await find(resolve(archive, 'Products/Applications'), name => name.endsWith('.app'));
        assert.equal(apps.length, 1);
        const app = apps[0];
        const extensions = await find(resolve(app, 'Contents/PlugIns'), name => name.endsWith('.appex'));
        assert.equal(extensions.length, 1);
        for (const [path, bundle] of [[app, 'io.uier.safari'], [extensions[0], 'io.uier.safari.Extension']]) {
            const info = plist(resolve(path, 'Contents/Info.plist'));
            assert.equal(info.CFBundleIdentifier, bundle); assert.equal(info.CFBundleShortVersionString, version); assert.equal(info.CFBundleVersion, version);
        }
        for (const file of files) assert.equal(digest(await readFile(resolve(extensions[0], 'Contents/Resources', file))),
            digest(await readFile(resolve(root, 'dist', file))), `Xcode changed extension resource ${file}`);
        let packages = [];
        if (signed) {
            command('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
            const options = resolve(temporary, 'ExportOptions.plist');
            // Xcode uses the same profiles as the signed archive. Read their UUIDs from target settings.
            const projectData = plist(projectFile), mapping = {};
            for (const object of Object.values(projectData.objects)) {
                const settings = object.buildSettings;
                if (settings?.PROVISIONING_PROFILE_SPECIFIER) mapping[settings.PRODUCT_BUNDLE_IDENTIFIER] = settings.PROVISIONING_PROFILE_SPECIFIER;
            }
            await writePlist(options, { method: 'app-store-connect', destination: 'export', signingStyle: 'manual', teamID: env.APPLE_TEAM_ID,
                signingCertificate: env.SAFARI_SIGNING_IDENTITY, installerSigningCertificate: '3rd Party Mac Developer Installer', provisioningProfiles: mapping });
            command('xcodebuild', ['-exportArchive', '-archivePath', archive, '-exportOptionsPlist', options,
                '-exportPath', resolve(out, 'export')], { stdio: 'inherit' });
            packages = await find(resolve(out, 'export'), name => name.endsWith('.pkg'));
            assert.equal(packages.length, 1, 'Expected one signed Mac App Store installer');
            command('pkgutil', ['--check-signature', packages[0]], { stdio: 'inherit' });
        }
        const receipt = { version, signed, archive, package: packages[0], files };
        await writeFile(resolve(out, 'build.json'), JSON.stringify(receipt, null, 2) + '\n');
        return receipt;
    } finally {
        await rm(temporary, { recursive: true, force: true });
        await Promise.all(profiles.map(file => rm(file, { force: true })));
    }
}
if (process.argv[1] === new URL(import.meta.url).pathname)
    await nativeArchive({ root: resolve(import.meta.dirname, '..'), signed: process.argv.includes('--signed') });
