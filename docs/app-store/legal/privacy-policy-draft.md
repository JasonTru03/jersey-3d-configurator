# Privacy Policy Draft — `{{APP_NAME}}`

Effective date: `{{EFFECTIVE_DATE}}`  
Operator: `{{LEGAL_ENTITY_NAME}}`  
Privacy contact: `{{PRIVACY_EMAIL}}`  
Address: `{{CONTACT_ADDRESS}}`

> Draft for legal review. This document is not legal advice and must not be published with unresolved placeholders.

## 1. Scope

This policy explains how `{{LEGAL_ENTITY_NAME}}` processes information when Shopify merchants install and use `{{APP_NAME}}`, and when customers use the 3D jersey customization experience provided through a merchant’s store.

## 2. Information processed

The app processes only information required to provide the customization, checkout protection, order linking, and production-file workflow:

- Merchant store domain, installation status, granted scopes, and encrypted offline access token.
- Shopify product and variant identifiers selected by the merchant.
- Custom jersey configuration data, including selected options, colors, text supplied for the design, artwork selections, and generated preview/production files.
- Shopify order identifier, order display name, line-item identifiers/properties required to verify and link a paid order, and order lifecycle state.
- Security and operational records such as webhook delivery IDs, timestamps, configuration revisions, and production-file download audit outcomes.

The app does not request or intentionally store customer name, postal address, email address, or phone number. Shopify webhook payloads are authenticated and may be processed transiently, but fields not required for the functions above are not retained.

## 3. Purposes

Information is processed only to:

- Install, authenticate, configure, operate, secure, and support the app.
- Price and validate configured jersey components in cart and checkout.
- Associate a paid Shopify order with the correct production design package.
- Provide authorized production staff with order-linked manufacturing files.
- Detect abuse, diagnose failures, meet privacy requests, and maintain required audit records.

The app does not sell personal information, use it for cross-context behavioral advertising, or make decisions with legal or similarly significant effects.

## 4. Legal roles and merchant responsibilities

`{{DATA_ROLE}}`. Merchants remain responsible for their own privacy notices, lawful instructions, customer consent choices, and use of production files. The parties’ roles should be confirmed in the final data processing terms.

## 5. Sharing and service providers

Information is shared only with Shopify and infrastructure providers required to host the application, database, encrypted backups, and production files. Final provider names, processing locations, and cross-border transfer terms: `{{SERVICE_PROVIDER_DETAILS}}`.

## 6. Retention

- Unpaid draft design packages expire after 30 days and are deleted by scheduled cleanup.
- Short-lived cart quote records expire after their configured service period.
- Paid production design packages and their order link are retained for `{{PAID_DESIGN_RETENTION_DAYS}}` days after payment, unless deletion is required earlier by a verified privacy request or law.
- OAuth installation data is disabled on uninstall and deleted when Shopify sends the applicable shop-redaction request.
- Privacy request and minimum security audit records are retained only as long as needed to demonstrate completion and protect the service.

The paid-design retention period must be implemented and verified before this policy is published.

## 7. Security

The service uses HTTPS in transit, AES-GCM encryption for Shopify offline tokens and per-store Function signing secrets, HMAC verification for Shopify requests, access controls for production files, input limits, rate limits, and audit records. Production backups must be encrypted and access-restricted before public launch.

No method of storage or transmission is completely secure. Security incidents are handled under `{{INCIDENT_RESPONSE_POLICY_REFERENCE}}`.

## 8. Privacy choices and requests

Merchants and customers can contact the merchant or `{{PRIVACY_EMAIL}}` about access or deletion. The app also processes Shopify’s mandatory `customers/data_request`, `customers/redact`, and `shop/redact` webhooks. Requests may require identity or authority verification.

Where applicable, the service respects customer consent and opt-out decisions communicated through the merchant or Shopify. The current app does not use data for advertising or data sale.

## 9. International transfers

Processing locations and applicable transfer safeguards: `{{INTERNATIONAL_TRANSFER_DETAILS}}`.

## 10. Changes

Material changes will be reflected by updating the effective date and providing notice where required.

## 11. Contact

`{{LEGAL_ENTITY_NAME}}`  
`{{CONTACT_ADDRESS}}`  
`{{PRIVACY_EMAIL}}`
