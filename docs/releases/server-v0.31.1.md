# Nova Server 0.31.1 — On-premises Active Directory

Download **IDK-Nova-Server-0.31.1.tar.gz** and its **.sha256** below. This is the Linux server deployment package, not a desktop installer. Read `README.fa.md` and `onprem/README.fa.md` inside the archive.

## Local AD defaults

- Internal OIDC issuer (`https://sso.company.internal/realms/company`), client ID `nova-web`, and explicit `nova-users` group restriction instead of Microsoft Online/Entra defaults. Replace example hosts, groups and model IDs with real company values.
- Internal AI endpoint example; model hosting is independent of AD authentication.
- New installs include a corporate-PKI Compose override. Supply Nova's server certificate/private key and the trusted company CA bundle; no public ACME/DNS is required for this profile. TLS verification stays enabled.
- Detailed Persian IT instructions for internal Keycloak → LDAPS → local AD, read-only service-account permissions, group mappings, private network/DNS and separate certificate trust on employees' devices.
- Keycloak/AD FS remain company-managed identity infrastructure; this package does **not** automatically install Keycloak or connect directly to LDAP. Authentication does not require a Microsoft cloud account.
- Independent server release/update channel, missing-certificate preflight and `manage.sh use X.Y.Z` to activate a verified manually installed version.

## Existing installations

Configuration and secrets are never silently rewritten. For migration from 0.31.0, download/verify/extract this archive, run its `install.sh` with the same installation path, prepare the CA/TLS files, merge the on-prem override if appropriate, update the internal issuer/groups, and run `manage.sh use 0.31.1`. Back up configuration first; code rollback is not configuration rollback. Customized deployments must merge rather than overwrite their existing override.

Local AD does not imply offline installation. Docker images/build dependencies and GitHub updates require egress or IT-managed mirrors. An external AI provider still requires its own connectivity. Fully air-gapped one-click installation and automatic Windows integrated sign-in are not included.

## Verification

Server tests cover signed OIDC exchanges, PKCE/state/nonce, group denial, account isolation, streaming proxy, request limits, safe paths, logout, update/checksum/rollback, and on-prem defaults. A separate TLS test confirms internal issuer discovery fails without the corporate CA and succeeds with `NODE_EXTRA_CA_CERTS`, without disabling verification. GitHub CI builds/tests the packaged Linux image and validates the corporate TLS Caddy/Compose configuration with a temporary test certificate.

Real company AD, groups, DNS, certificates and provider load still require IT acceptance testing. The Nova UI is unchanged; history remains account-scoped browser data and desktop-only Work stays disabled on the website.

[راهنمای فارسی IT](https://github.com/r-winn/IDK-Nova/blob/server-v0.31.1/server/onprem/README.fa.md) · [نمونه کانفیگ](https://github.com/r-winn/IDK-Nova/blob/server-v0.31.1/server/config.example.json) · [نمونه Secrets](https://github.com/r-winn/IDK-Nova/blob/server-v0.31.1/server/.env.example)
