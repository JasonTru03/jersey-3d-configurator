# Design asset write access

`POST /api/design-assets` requires `Authorization: Bearer TOKEN`, where `TOKEN` exactly matches the Worker secret `DESIGN_ASSET_WRITE_TOKEN`. Configure the secret outside source control before deployment:

```powershell
npx wrangler secret put DESIGN_ASSET_WRITE_TOKEN
```

The Shopify launcher forwards a short-lived `designToken` only when supplied. The configurator uses it for atlas upload and never bundles a write secret in JavaScript. Without a token, bottom-pattern preview and local design-file save remain available; Add to Shopify cart displays an error when asset storage is needed.
