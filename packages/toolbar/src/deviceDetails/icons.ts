/**
 * Lucide icons (ISC, lucide.dev; lucide-react 1.72.0) for the device details, as Lucide's own element lists: the
 * toolbar's icon set (`@signalco/ui-icons`) lacks some of them and the app's (`lucide-react`) is not in the review
 * bundle, so the shared `DeviceDetails` draws them itself. Names say what they stand for, not the Lucide name.
 */

type Element = ['path' | 'rect' | 'line' | 'circle', Record<string, string>];

export const deviceIcons = {
    // monitor
    desktop: [
        ['rect', { width: '20', height: '14', x: '2', y: '3', rx: '2' }],
        ['line', { x1: '8', x2: '16', y1: '21', y2: '21' }],
        ['line', { x1: '12', x2: '12', y1: '17', y2: '21' }]
    ],
    // tablet
    tablet: [
        ['rect', { width: '16', height: '20', x: '4', y: '2', rx: '2', ry: '2' }],
        ['line', { x1: '12', x2: '12.01', y1: '18', y2: '18' }]
    ],
    // smartphone
    mobile: [
        ['rect', { width: '14', height: '20', x: '5', y: '2', rx: '2', ry: '2' }],
        ['path', { d: 'M12 18h.01' }]
    ],
    // hand
    touch: [
        ['path', { d: 'M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2' }],
        ['path', { d: 'M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2' }],
        ['path', { d: 'M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8' }],
        ['path', { d: 'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15' }]
    ],
    // mouse-pointer-2
    mouse: [
        ['path', { d: 'M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z' }]
    ],
    // sun
    light: [
        ['circle', { cx: '12', cy: '12', r: '4' }],
        ['path', { d: 'M12 2v2' }],
        ['path', { d: 'M12 20v2' }],
        ['path', { d: 'm4.93 4.93 1.41 1.41' }],
        ['path', { d: 'm17.66 17.66 1.41 1.41' }],
        ['path', { d: 'M2 12h2' }],
        ['path', { d: 'M20 12h2' }],
        ['path', { d: 'm6.34 17.66-1.41 1.41' }],
        ['path', { d: 'm19.07 4.93-1.41 1.41' }]
    ],
    // moon
    dark: [
        ['path', { d: 'M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401' }]
    ],
    // accessibility
    motion: [
        ['circle', { cx: '16', cy: '4', r: '1' }],
        ['path', { d: 'm18 19 1-7-6 1' }],
        ['path', { d: 'm5 8 3-3 5.5 3-2.36 3.5' }],
        ['path', { d: 'M4.24 14.5a5 5 0 0 0 6.88 6' }],
        ['path', { d: 'M13.76 17.5a5 5 0 0 0-6.88-6' }]
    ],
    // languages
    language: [
        ['path', { d: 'm5 8 6 6' }],
        ['path', { d: 'm4 14 6-6 2-3' }],
        ['path', { d: 'M2 5h12' }],
        ['path', { d: 'M7 2h1' }],
        ['path', { d: 'm22 22-5-10-5 10' }],
        ['path', { d: 'M14 18h6' }]
    ],
    // arrow-up-right
    external: [
        ['path', { d: 'M7 7h10v10' }],
        ['path', { d: 'M7 17 17 7' }]
    ]
} satisfies Record<string, Element[]>;

export type DeviceIconName = keyof typeof deviceIcons;
