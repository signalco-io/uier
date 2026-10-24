import { config } from '@signalco/ui-themes-minimal/config';

// Tailwind CSS v4 loads this JS config through `@config` in app/global.css.
// Sources are declared with `@source` in CSS, so `content` is not needed here.
/** @type {import('tailwindcss').Config} */
export default {
    presets: [config],
};
