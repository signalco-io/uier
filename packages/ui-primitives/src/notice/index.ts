// The notice that travels with every artifact that ships kit code: the review script's closing legal
// comment (packages/toolbar/tsup.config.ts), the browser extensions' THIRD-PARTY-NOTICES.txt
// (packages/extension/scripts/notices.mjs) and the website's /open-source page. No imports: Node
// scripts load this file as it is.

/** The kit's packages: local copies of signalco's MIT-licensed npm packages (../../AGENTS.md) */
export const kitPackages = ['@uier/ui-primitives', '@uier/ui', '@uier/ui-icons', '@uier/ui-notifications', '@uier/ui-themes-minimal', '@uier/cms-core', '@uier/js'];

/** signalco's copyright and permission notice, the text of each kit package's LICENSE file */
export const kitLicense = `MIT License

Copyright (c) signalco

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

/** What the kit is and where it comes from, in one line, above the notice */
export const kitNoticeTitle = `uier UI kit (${kitPackages.join(', ')}), based on signalco's UI packages (https://github.com/signalco-io/signalco)`;
