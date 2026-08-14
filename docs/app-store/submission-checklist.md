# Shopify App Store Submission Checklist

## Product and runtime

- [x] GraphQL Admin API only for new public app functionality.
- [x] Standard OAuth authorization-code install and reinstall flow.
- [x] Mandatory privacy webhooks with raw-body HMAC verification.
- [x] `app/uninstalled` and `app/scopes_update` lifecycle handling.
- [x] Theme App Extension instead of direct theme modification.
- [x] Per-store encrypted token and configuration isolation.
- [x] Cart Transform and Validation readback before activation.
- [ ] Deploy candidate to the fixed HTTPS `workers.dev` origin.
- [ ] Complete full fresh-development-store regression.
- [ ] Confirm no 3xx/4xx/5xx errors in reviewer happy path.

## Listing

- [ ] Resolve final App name and developer name.
- [ ] Confirm primary listing language matches the complete merchant UI.
- [ ] Select “Merchant must have online store”.
- [ ] State Online Store 2.0 and USD requirements accurately.
- [ ] Confirm category/tag against current taxonomy.
- [ ] Confirm pricing and configure Shopify Billing/App Pricing if paid.
- [ ] Capture five unique real-UI screenshots without browser chrome.
- [ ] Record English or English-subtitled onboarding screencast.
- [ ] Prepare valid review store and portal credentials outside source control.

## Legal, privacy, and support

- [ ] Legal review and publish Privacy Policy.
- [ ] Legal review and publish Terms of Service.
- [ ] Publish support page and valid support email.
- [ ] Add emergency developer contact email and phone.
- [ ] Confirm paid production file retention period.
- [ ] Implement and test paid-design retention cleanup.
- [ ] Encrypt off-site backups and complete restore exercise.
- [ ] Complete Protected Customer Data Level 1 request without protected fields.

## Final controls

- [ ] Run Shopify app self-review against the candidate.
- [ ] Save non-sensitive automated-check evidence.
- [ ] User explicitly confirms creation of the final App version.
- [ ] User explicitly confirms irreversible Public distribution selection.
- [ ] Submit only after all items above are complete.
