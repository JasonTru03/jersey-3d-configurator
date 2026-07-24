# Navigation, Personalize, and Cart Production Handoff

## 1. Current checkpoint

- Date: `2026-07-24`
- Branch: `codex/continuous-bottom-pattern`
- Deployed code commit: `8734e08d7e324524cca57633676814bdadea1114`
- Handoff content commit: `da5349f5c49fd86fb5ffb99dd051697a545f6bcd`
- Handoff evidence checkpoint: `a19882349401dd857a9cef8ca853f839d8ec4bd2`
  (local, origin, and backup verified before this final documentation correction)
- Final documentation correction commit: recorded in the final delivery report
  after this file is committed and the three branch hashes are verified
- Merge status: not merged to `main`
- Working-tree companion: `.superpowers/` remains untracked and excluded

## 2. Cloudflare deployment

- Worker: `jersey-3d-configurator`
- Live URL: `https://jersey-3d-configurator.jason1064969838.workers.dev/`
- Current version: `110d64b1-9eee-4d7c-b7bc-4a9807c4e09f`
- Deployment timestamp: `2026-07-24T06:18:01.507Z`
- Rollback version: `8f60a18e-e881-43c0-904d-fdfd77dd106d`
- Cache-busting readback: `/?acceptance=20260724-1419`

Deployed assets:

| Asset | HTTP | Bytes |
| --- | ---: | ---: |
| `/` | 200 | 532 |
| `/assets/index-BfBRt4zi.js` | 200 | 997,950 |
| `/assets/index-DNjnujNy.css` | 200 | 16,968 |
| `/favicon.ico` | 404 | expected plain-text fallback |

The index returned `text/html`, `Cache-Control: public, max-age=0, must-revalidate`,
and referenced the asset names above. The browser console contained no error or
warning entry for the accepted Worker page.

Rollback:

```powershell
cd C:\Users\Administrator\Documents\可编辑自定义产品\jersey-3d-configurator\.worktrees\codex\continuous-bottom-pattern
npx wrangler rollback 8f60a18e-e881-43c0-904d-fdfd77dd106d
npx wrangler deployments status --name jersey-3d-configurator
```

Successful rollback means the deployment status returns the rollback version at
100% and the versioned index/assets return HTTP 200.

## 3. Automated verification

Fresh pre-deployment verification on `8734e08`:

| Check | Result |
| --- | --- |
| `npm test -- --run` | 41 files, 332 tests passed |
| `npm run build:app` | passed |
| `npm run build:shopify` | passed |
| App JS | `index-BfBRt4zi.js`, 997.95 kB, gzip 278.76 kB |
| App CSS | `index-DNjnujNy.css`, 16.96 kB, gzip 3.79 kB |
| Shopify bundle | 1,355.38 kB, gzip 383.66 kB |
| `git diff --check 89ae7a0..HEAD` | passed |

The existing Vite large-chunk warning and Shopify `inlineDynamicImports` warning
remain non-blocking.

## 4. Live Worker browser acceptance

### Desktop `1908 × 942`

| Measurement | Size | Design | Personalize |
| --- | ---: | ---: | ---: |
| document client height | 942 | 942 | 942 |
| document scroll height | 942 | 942 | 942 |
| document scrollY | 0 | 0 | 0 |
| stage rect | `(272,84) 1224×834` | same | same |
| panel editor client height | 675 | 675 | 675 |
| panel editor scroll height | 675 | 917 | 675 |
| checkout footer | `(1513,839) 370×78` | same | same |

Other desktop readback:

- sidebar: Size, Design, Fabric, Personalize, Artwork, Extras;
- Design owns Jersey templates, Zone colors, and Continuous bottom pattern;
- stage caption: `Solid / Stadium knit`;
- one `CHELSEA FC` text changes `$89` to `$97`;
- Block font and spacing 6 read back;
- Rotate accepted; Duplicate changed the total to `$105`;
- Delete returned the total to `$97` and focus to the elements list;
- Review shows one custom text, `$8` customization subtotal, and `$97` total;
- initial Review focus is Close review;
- Save design file exposes a live `Download design JSON` link.

The previously recorded Chrome file-chooser limitation still applies to Open
design. The live Save side was repeated; a same-file live Open injection was not.

### Mobile `390 × 844`

- all six icon buttons retain accessible names;
- Review rect: `(0,0) 375×844`;
- Review client/scroll height: `843 / 979`;
- Review `overflow-y`: `auto`;
- after scrolling to `136`, Add to Shopify cart, Download design JSON, Save
  design file, and Continue editing are all inside the viewport;
- mobile uses normal document flow rather than the desktop height lock.

## 5. Shopify launcher and catalog readback

- Shop: `testcsj.myshopify.com`
- Product handle: `custom-3d-football-jersey`
- Product ID: `9676223545495`
- Live theme: `152029888663` (`Horizon`, `processing: false`)
- Launcher asset: `sections/product-3d-configurator-launch.liquid`
- Launcher SHA-256:
  `7DD82A7E4A8E360D097F5014EBB9C4623146DC696B68A30F69EAF88C2CB39DBF`
- Remote launcher and tracked source: byte-for-byte equal
- Live template order:
  `main -> product_3d_configurator_launch -> product_recommendations_qggXJq`

The launcher points to the stable Worker URL and dynamically emits both the
jersey `variantMap` and the surcharge map from
`all_products['3d-customization-surcharge']`. It already carries `$8`, `$12`,
`$18`, `$50`, and the other active variants. No theme write was needed.

Relevant Admin GraphQL readback:

| Item | Variant | Price | Available |
| --- | --- | ---: | --- |
| Jersey M | `48039101923479` | `$89` | yes |
| Surcharge 8 | `48046656028823` | `$8` | yes |
| Surcharge 12 | `48046656094359` | `$12` | yes |
| Surcharge 50 | `48046656651415` | `$50` | yes |
| Surcharge 62 | `48046656848023` | `$62` | yes |

The surcharge product is active and has 33 variants.

## 6. Exact-map `$97` cart

Production variant path generated by the deployed-code contract:

```text
/cart/48039101923479:1,48046656028823:1
```

Verified before navigation:

- merchandise: M jersey `$89`;
- customization: one custom text `$8`;
- quote total: `$97`;
- `Print: ""`;
- `Custom Text: "CHELSEA FC"`;
- one base line and one `$8` surcharge line.

Browser line-item readback status: pending. A single navigation from the same
pre-existing readable cart tab landed on
`https://testcsj.myshopify.com/password`. The DOM showed the Shopify storefront
password form. Back navigation restored the readable `$151` cart, and this path
was not repeated.

## 7. Composed-map `$151` cart

Production variant path generated with `$62` intentionally omitted from the map:

```text
/cart/48039101923479:1,48046656651415:1,48046656094359:1
```

Verified quote:

| Component | Amount |
| --- | ---: |
| M jersey | `$89` |
| Player mesh | `$24` |
| Name set | `$18` |
| Match patch | `$12` |
| Gift box | `$8` |
| Customization subtotal | `$62` |
| Total | `$151` |

Verified generated properties:

- `Print: "PLAYER #16"`;
- `Custom Text: ""`;
- `Extras: "giftBox, matchPatch"`.

Verified generated surcharge lines are `$50` plus `$12`, one unit each.
One composed-cart navigation was then made from that same restored cart tab. It
also landed on the Shopify storefront password form. Back navigation restored
the original cart again. Browser line-item readback remains pending, and no
further composed-cart navigation was attempted.

## 8. Real Shopify cart evidence available in this session

A task-start pre-existing Shopify cart tab was readable and is retained for the
user:

- M jersey line: `$89`, quantity 1;
- exact `$62` surcharge line: `$62`, quantity 1;
- cart count: 2;
- estimated total: `$151.00 USD`;
- jersey properties include `Print: PLAYER #16` and
  `Extras: giftBox, matchPatch`.

This is exact `$62` evidence from an earlier cart state. It is not evidence for
the new `$50 + $12` composed path and does not include `CHELSEA FC`.

No checkout was entered, no order was created, and no customer, address, or
payment data was read.

## 9. Production Open design evidence

- Save design on the production Worker generated and downloaded
  `C:\Users\Administrator\Downloads\fn8788-jersey-design (3).json`.
- The file is 1,662 bytes, `jersey-design` v3, with layout M.
- Open design raised a single-file chooser; `isMultiple()` returned false.
- The one `setFiles` call returned `Not allowed`.
- The result matches the Chrome extension file URL permission boundary recorded
  earlier, so the chooser path was stopped after this attempt.

To complete this check, open Chrome extensions, select Details for the ChatGPT
Chrome Extension, enable `Allow access to file URLs`, and then select the saved
v3 file once.

## 10. Remaining acceptance

Use a storefront session that has passed the password page and is stable:

1. open the live product and start the 3D configurator;
2. add `CHELSEA FC`, confirm Review `$97`, add to cart, and read back M `$89`
   plus surcharge `$8`, including `Custom Text: CHELSEA FC` and empty Print;
3. launch with `$62` omitted but `$50` and `$12` present, recreate the four
   `$62` options, and read back three cart lines totaling `$151`;
4. repeat Open design after enabling Chrome file URL access;
5. manually read back the native color control.

These browser items are the only outstanding production acceptance. Cloudflare
deployment, version/assets, desktop/mobile UI, Shopify live theme/launcher, live
catalog variant values, exact path generation, and composed path generation are
all read back.
