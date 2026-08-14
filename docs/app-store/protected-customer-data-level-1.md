# Protected Customer Data Level 1 Draft

Status: evidence draft for Partner Dashboard review. Final answers must match the live deployment and legal policy.

## Access requested

- Protected customer data Level 1 because the app processes Shopify order resources and order webhooks.
- No access requested for customer name, address, email, or phone fields.
- `read_orders` is required only to associate paid/cancelled/refunded orders with the corresponding custom jersey production package and lifecycle state.

## Data minimization

Persisted order data is limited to store domain, Shopify order GID, order display name, relevant line-item properties/identifiers, lifecycle state, timestamps, and the linked design/production package. Customer identity and contact fields are not intentionally persisted.

## Transparency and purpose limitation

The privacy policy states the exact data categories and purposes. Order data is used only for payment-state verification, order-to-design linking, production access, privacy compliance, support, and security. It is not used for advertising, profiling, data sale, or significant automated decisions.

## Consent and opt-out

The app does not perform advertising or data-sale processing. Where applicable, verified merchant/customer consent or opt-out instructions are honored through Shopify privacy workflows or direct verified requests.

## Agreements

- Public Privacy Policy: `{{PRIVACY_POLICY_URL}}`
- Terms of Service: `{{TERMS_URL}}`
- Data Processing Agreement or incorporated processing terms: `{{DPA_URL_OR_SECTION}}`

## Retention

- Unpaid production drafts: 30 days.
- Paid production packages: `{{PAID_DESIGN_RETENTION_DAYS}}` days after payment.
- Earlier deletion: verified `customers/redact` or `shop/redact` request, or applicable law.

Blocker: the paid production retention period needs business confirmation and automated cleanup implementation before submission.

## Encryption

- In transit: HTTPS/TLS on public and internal service endpoints.
- At rest: Shopify offline tokens and Function signing secrets use AES-GCM with shop- and purpose-bound additional authenticated data.
- Production database/object storage and off-site backups: `{{AT_REST_AND_BACKUP_ENCRYPTION_EVIDENCE}}`.

## Access controls and audit

- Production portal uses password hashing, signed secure sessions, rate limits, per-store authorization, and download outcome audit records.
- Shopify requests require OAuth/session or HMAC verification.
- Staff access policy, account review cadence, and emergency revocation: `{{STAFF_ACCESS_POLICY}}`.

## Incident response

- Incident response owner: `{{INCIDENT_OWNER}}`.
- Detection, containment, evidence preservation, remediation, legal assessment, and notification procedure: `{{INCIDENT_RESPONSE_POLICY}}`.

## Evidence still required

- Encrypted off-site backup and successful restore exercise.
- Paid-design retention cleanup test.
- Public policy URLs on the final branded domain.
- Emergency developer contact in Partner Dashboard.
- Screenshots or configuration evidence for access controls without exposing secrets.
