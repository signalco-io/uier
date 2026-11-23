# UI kit (`@uier/ui-primitives` and the packages beside it)

The components of the public pages, the review toolbar and the extension popup. They are local copies
of the `@signalco/*` npm packages the repository used before, taken from the signalco monorepo's
sources at the published versions (MIT; each package keeps the notice in its `LICENSE`). Only the
modules the repository imports were copied, each whole. This guide covers all seven packages.

| Package | Import | What | Copied from |
| --- | --- | --- | --- |
| `packages/ui-primitives` | `@uier/ui-primitives/<Name>` | `Avatar`, `Button`, `Checkbox`, `Chip`, `Container`, `Divider`, `IconButton`, `Input`, `Link`, `List`, `ListItem`, `Popper`, `Row`, `Skeleton`, `Stack`, `Typography`, `cx`, the `theme` types and the kit's `notice` | `@signalco/ui-primitives` 0.6.5 |
| `packages/ui` | `@uier/ui/Nav` | `PageNav`, the public pages' header | `@signalco/ui` 0.2.10 |
| `packages/ui-icons` | `@uier/ui-icons` | Lucide icons under the kit's names (`Close`, `Add`, `Delete`, `LoaderSpinner`) | `@signalco/ui-icons` 0.2.2 |
| `packages/ui-notifications` | `@uier/ui-notifications` | `NotificationsContainer`, the public layout's Sonner region | `@signalco/ui-notifications` 0.2.0 |
| `packages/ui-themes-minimal` | `@uier/ui-themes-minimal/config` | the Tailwind CSS preset: colours, radius, dark mode, animations | `@signalco/ui-themes-minimal` 0.1.3 |
| `packages/cms-core` | `@uier/cms-core/SectionData` | the section type of the marketing blocks | `@signalco/cms-core` 0.1.1 |
| `packages/js` | `@uier/js` | `isAbsoluteUrl` | `@signalco/js` 0.1.0 |

## How they are used

- **Source packages, no build step.** Each `exports` entry points into `src/`. Next.js compiles them
  as app code (`transpilePackages` in `apps/web/next.config.ts`), the toolbar's tsup build and the
  extension's esbuild build bundle them, and Tailwind reads their class names through `@source`
  (`apps/web/app/global.css`, `packages/toolbar/src/index.css`). A new kit package needs its
  `transpilePackages` entry and, when it has class names, its `@source` lines. `pnpm dev` rebuilds
  the toolbar when `packages/ui-primitives/src` or `packages/ui-icons/src` changes (`dev:build`).
- **Who uses what.** Public pages, the toolbar and the extension popup use this kit. The signed-in
  app (`/app`) uses the shadcn/ui components in `apps/web/src/components/ui`. Do not mix the two on
  one surface and do not build parallel buttons, inputs or menus.
- **`/brand/components`** shows every kit component in its states
  ([brand page note](../../apps/web/docs/brand-page.md)). Add a component's entry and states there
  with the component.

## Rules for a change

- **Three surfaces render every component:** the website, the toolbar's shadow root on any reviewed
  page, and the extension popup. Keep a component's props, markup and class names unless changing them
  is the point, and check all three.
- **Class names are written for Tailwind CSS v3.** `tailwind-v3-compat.css` (website and toolbar)
  restores the v3 meaning of the names v4 changed, and `cx` merges classes with `tailwind-merge` 2,
  which knows the v3 names. Move both together when the kit moves to v4 names.
- **Client components** are marked in the component's `index.ts` (`Button`, `Checkbox`, `ListItem`,
  `Popper`). The others render in Server Components; keep them free of state and effects.
- **The toolbar runs on any page.** No Next.js imports besides `Link`'s `next/link`, which the
  toolbar and extension builds alias to a native anchor. A length in `rem` in an inline style must be
  a template literal that ends in `rem` (`` `${spacing * 0.5}rem` ``, as in `Row` and `Stack`): the
  toolbar and extension builds rewrite those to `--uier-rem` (`uiKitInlineRem`,
  [host styles](../toolbar/docs/host-styles.md)) and fail on any other form.
- **Pinned on purpose.** `lucide-react` in `packages/ui-icons` is the version the kit shipped with
  (0.507.0). The app's own `lucide-react` is newer and draws many of the same icons differently, so
  an update changes what the toolbar and the public pages show: look at the icons when you take one.
  `@radix-ui/react-popover` and `@radix-ui/react-checkbox` are the versions the kit bundled.
- **Icons.** Add one by exporting it from `packages/ui-icons/src/lucide/index.ts`, under the name the
  kit would call it. Lucide only, outlined ([BRAND.md](../brand/BRAND.md)).
- **Notifications.** `NotificationsContainer` has its own toaster id: it shows only toasts sent with
  `toasterId: notificationsToasterId`, never the app's `toast()` calls, which the app's toaster shows.
- **The MIT notice ships with every artifact.** `src/notice` holds signalco's notice (the text of each
  package's `LICENSE`) and the kit's package names. The review script ends with it in a legal comment
  (`packages/toolbar/tsup.config.ts`), the browser extensions package it in `THIRD-PARTY-NOTICES.txt`
  (`packages/extension/scripts/notices.mjs`; validation refuses a package without it) and the website
  shows it on `/open-source`. A new kit package gets the same `LICENSE` and a `kitPackages` entry; a
  new artifact that ships kit code carries the notice too.
