# Nova Server 0.31.3 — Branded company sign-in

Download **IDK-Nova-Server-0.31.3.tar.gz** and its checksum. The package retains the local-AD/corporate-TLS setup and now includes a **Nova login theme for internal Keycloak**.

- Minimal Nova-style light/dark appearance, responsive layout, Persian/English labels, RTL support, local logo/assets and reduced-motion behavior.
- Optional `oidc.uiLocales` requests the preferred language using standard OIDC `ui_locales` (the example prioritizes `fa en`).
- Native Keycloak authentication templates are inherited, not rewritten: form actions, session protection, errors and enabled MFA flows remain owned by Keycloak. Only styling, translations and a presentation footer are added.
- Optional brand exporter reads Nova `ui.branding` to prepare logo, color and suggested realm display-name/theme settings. It never exports provider or OIDC secrets. IT reviews/applies the realm settings; there is no automatic cross-service branding sync.
- A loopback-only visual preview is available with `npm run login:preview` from source or `node keycloak/preview.mjs` from the extracted package. It accepts no login submissions and is not AD authentication.
- The theme must be mounted/selected on the company's existing Keycloak. AD FS has its own separate branding system. Company identity infrastructure is not installed automatically.

The release pipeline tests backend behavior, branding validation, the packaged Linux container/corporate TLS profile, and renders the actual native Keycloak 26.8.1 login in English and Persian before publishing. Real AD, credentials, MFA and company policy acceptance tests still belong to IT.

Existing Nova configuration and secrets are preserved. Updating the Nova container does not update a separately hosted Keycloak theme mount: follow the theme guide to deploy new files to the persistent Keycloak theme path and refresh its cache/restart appropriately.

[راهنمای نصب تم و پیش‌نمایش](https://github.com/r-winn/IDK-Nova/blob/server-v0.31.3/server/keycloak/README.fa.md) · [راهنمای AD لوکال](https://github.com/r-winn/IDK-Nova/blob/server-v0.31.3/server/onprem/README.fa.md)
