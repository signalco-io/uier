# GitHub presence

uier lives at [signalco-io/uier](https://github.com/signalco-io/uier). Its company page is the
[signalco organization](https://github.com/signalco-io), where uier has a product section and a pinned
repository. Keep the signalco identity and its other projects intact when updating that page.

## Repository details

The repository's About section uses the existing brand description and site:

- Description: Review any live website by leaving comments directly on it.
- Website: https://uier.io
- Topics: `website-feedback`, `visual-feedback`, `website-review`, `design-review`, `collaboration`,
  `annotations`, `developer-tools`, `typescript`, `nextjs`, `react`, `mcp`.

These settings live on GitHub, outside Git. With repository admin access, update the description
and website using `gh repo edit signalco-io/uier --description 'Review any live website by leaving comments directly on it.' --homepage https://uier.io`.
Edit topics from the repository's About panel. Use only topics that describe implemented behavior.

The README is the product and contributor entry point. [SUPPORT.md](../SUPPORT.md),
[CONTRIBUTING.md](../CONTRIBUTING.md), [SECURITY.md](../SECURITY.md), the
[issue forms](../.github/ISSUE_TEMPLATE) and the [pull request template](../.github/pull_request_template.md)
provide the existing contact and contribution routes. Licenses remain package-specific; see
[the README](../README.md#license). There is no uier-specific mailbox, social account or sponsorship
program to list.

## Social preview

The committed [social preview](../.github/assets/social-preview.png) is a 1280 × 640 PNG, also used
as the README cover. It exports the existing paper-background brand card from
[`opengraph-image.tsx`](../apps/web/app/opengraph-image.tsx), with its logo, tagline, description,
domain, pin and toolbar motif. Its colours, fonts and copy come from `@uier/brand`.

To refresh it after a brand change ships, run from the repository root:

```bash
curl --fail --location https://uier.io/opengraph-image --output /tmp/uier-github-og.png
pnpm -C packages/brand exec node --input-type=module <<'JS'
import sharp from 'sharp';
import { brand } from './src/brand.ts';

await sharp('/tmp/uier-github-og.png')
    .extend({ top: 5, bottom: 5, left: 40, right: 40, background: brand.colors.paper })
    .removeAlpha()
    .png()
    .toFile('../../.github/assets/social-preview.png');
JS
```

The root card is 1200 × 630. Paper padding adapts it to GitHub's recommended dimensions without
cropping or stretching it. Review the output and commit it. To use a local build instead, download
its `/opengraph-image` route to the same temporary file.

In [repository settings](https://github.com/signalco-io/uier/settings), use **Social preview → Edit →
Upload an image** to upload the committed PNG. Committing an image does not configure the preview;
the upload is a separate setting. GitHub documents the size and upload steps in its
[social preview guide](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview).

## Company page

The public organization README is `profile/README.md` in
[signalco-io/.github](https://github.com/signalco-io/.github). Its uier section uses a copy of the
preview at `profile/assets/uier-social-preview.png` in that repository so the organization page's
image is independent of this repository's branches. Refresh that copy with the canonical asset.

Keep the section short: the branded cover, pinned feedback and browser context, links to
[uier.io](https://uier.io), [the app](https://uier.io/app), this repository and its documentation.
Use absolute image URLs in the organization README because GitHub renders it on the organization
Overview page. See GitHub's [organization profile guide](https://docs.github.com/en/organizations/collaborating-with-groups-in-organizations/customizing-your-organizations-profile).
