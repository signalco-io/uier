# packages/brand - agent guide

`@uier/brand` is the single source of truth for how uier looks: design tokens, the logo
components, brand constants, assets and the written guidelines. The web app and the toolbar
both consume it, and [uier.io/brand](https://uier.io/brand) renders from it.

**Read [`BRAND.md`](BRAND.md) first.** It explains every value here and the rules around them.

## Files

| File | What | Consumed by |
| --- | --- | --- |
| `BRAND.md` | the guidelines: name, voice, logo, colour, type, shape, review layer, marketing | humans and agents |
| `tokens.css` | CSS variables (HSL triplets) that override the signalco minimal theme; `:root, :host` and `.dark` | `apps/web/app/global.css`, `packages/toolbar/src/index.css` |
| `src/brand.ts` | `brand` constants (name, tagline, copy, links, contact addresses, hex mirrors, radii, fonts), `MARK_PATH`, `PIN_PATH`, `GEIST_FONTS_URL` | metadata, manifest, OG image, footer, toolbar |
| `src/Mark.tsx` | `<Mark />`, the mark as inline SVG in `currentColor` | nav, footer, brand page |
| `src/Logo.tsx` | `<Logo />`, mark + wordmark lockup (inline styles, shadow-DOM safe) | nav, footer, brand page |
| `src/Pin.tsx` | `<Pin count />`, the product pin with a white ring and thread count | landing, brand page |
| `assets/` | `mark.svg`, `mark-white.svg`, `logo.svg`, `logo-white.svg`, `favicon.svg` (adaptive) | README, external use, `apps/web/public/favicon.svg` |
| `scripts/render-icons.mjs` | renders the PNG icon set into `apps/web/public` with sharp | `pnpm -C packages/brand icons` |

Exports (`package.json`): `@uier/brand` (constants + components), `@uier/brand/tokens.css`,
`@uier/brand/Mark`, `@uier/brand/Logo`, `@uier/brand/Pin`, `@uier/brand/assets/*`.
The package ships TypeScript source; Next.js compiles it through `transpilePackages`, tsup
bundles it directly. It has no build step.

## Changing something

1. Change the value here, in one place: `tokens.css` for colour and radius (HSL triplet
   without `hsl()`), `src/brand.ts` for names, copy and the hex mirrors, `src/Mark.tsx` /
   `src/brand.ts` for the shape.
2. Keep the hex mirrors in `src/brand.ts` equal to the HSL values in `tokens.css`.
3. Update `BRAND.md` so the rule and the value agree; it is the document people read.
4. If the mark changed: `pnpm -C packages/brand icons`, copy `assets/favicon.svg` to
   `apps/web/public/favicon.svg`, commit the PNGs.
5. Run the web app and check `/brand`; `pnpm test` covers the page and the assets.

## Do not

- Add a second colour system, a component library or Tailwind classes to the components here
  (they render inside the toolbar's shadow root where no utility classes exist; use inline styles).
- Put copy that belongs to one page into `brand.ts`; it holds only the brand-level strings
  (name, tagline, descriptions, pronunciation, links, contact addresses).
- Redraw the mark or the pin anywhere else. Import `MARK_PATH` / `PIN_PATH` or the components.
