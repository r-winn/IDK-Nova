# IDK Nova Server

Linux deployment of the **same Nova web UI**, configured by default for **on-premises Active Directory**, internal OIDC sign-in and corporate TLS certificates. Docker Compose runs a Node.js gateway and Caddy HTTPS endpoint. No Microsoft cloud account is required for AD authentication. There is no Linux desktop emulator or access to users' computers from the website.

**Start with [the on-premises IT checklist (Persian)](onprem/README.fa.md).** Local AD is not the same as a fully air-gapped deployment: installation/images and GitHub updates require network access or IT-managed mirrors, and AI provider connectivity is independent.

**Nova-branded login:** the bundle includes `keycloak/themes/nova`, a presentation-only theme inheriting native Keycloak login forms. Install/select it on the company's Keycloak realm; see [theme installation, branding and safe local preview](keycloak/README.fa.md). It uses English-only sign-in, automatic OS light/dark appearance, an icon and a frameless form with local assets. It is not an AD FS theme, does not install Keycloak, and does not replace its authentication/session/MFA logic. CI renders the native theme on isolated Keycloak 26.8.1; upgrade-specific compatibility still needs IT testing.

## Requirements

- Linux x86_64 or ARM64, Docker Engine with Compose v2 supporting `up --wait`, Bash, curl, GNU tar/coreutils; outbound HTTPS for images, npm, GitHub, the identity provider and AI providers.
- Internal DNS names for Nova and the identity service, HTTPS access on TCP 443, and corporate certificates trusted by servers and employee browsers. New installations use `onprem/compose.override.yaml`: the certificate is supplied by IT, not public ACME. TCP 80 is only for HTTPS redirects in the base deployment.
- A confidential OIDC application on internal AD FS (2016+) or internal Keycloak federated to AD over LDAPS. **A plain AD domain controller is not an OIDC provider.** Keycloak and its persistent database are not installed by this bundle. Do not send AD passwords to Nova. Domain join is not required for this OIDC path; automatic Windows/Kerberos sign-in is a separate setup.
- Starting allocation: 2 vCPU / 2 GB RAM for a small gateway deployment, plus disk for Docker images and rollback versions. This is not an AI inference server; load test for the actual number of users. Local model hosting needs separate hardware.

## Install

Download `IDK-Nova-Server-X.Y.Z.tar.gz` and its `.sha256` from the same official GitHub release. On Linux:

```sh
sha256sum -c IDK-Nova-Server-X.Y.Z.tar.gz.sha256
mkdir nova-server-package
tar -xzf IDK-Nova-Server-X.Y.Z.tar.gz -C nova-server-package
cd nova-server-package
sudo bash install.sh /opt/idk-nova
sudo nano /opt/idk-nova/config/config.json
sudo nano /opt/idk-nova/config/.env
# Supply corporate CA and the matching Nova TLS certificate/private key first.
# See onprem/README.fa.md for paths and permissions.
sudo /opt/idk-nova/manage.sh start
sudo /opt/idk-nova/manage.sh status
```

Use the real archive version instead of X.Y.Z. The download contains **no company keys**. Do not put `.env` or a configured server directory on GitHub or distribute it to clients.

### IT configuration checklist

1. `publicOrigin`: exact internal HTTPS origin, e.g. `https://nova.company.internal`, no path or trailing slash. Replace every example with the real company's DNS names. Serve Nova at the domain root, not a subdirectory.
2. `.env` `NOVA_DOMAIN`: the same host, e.g. `nova.company.internal`.
3. OIDC redirect URI: **`https://nova.company.internal/auth/callback`**. Register as a confidential **web** application using Authorization Code, client secret, PKCE S256 and query response mode. Do not register as an SPA. Use the exact issuer from the internal identity service's discovery document.
4. Put issuer/client ID in `config.json`, actual client secret in `.env` under the name referenced by `clientSecretEnv`. `openid profile email` are the default scopes; group mappings are optional.
5. The example restricts `allowedGroups` to `nova-users`. Map AD groups into an array claim in the ID token; use the exact value (e.g. `/nova-users` if the mapper includes a leading slash). Missing claims fail closed with 403. Empty `allowedGroups` means all identities allowed by the issuer/application, not anonymous access; do not remove restrictions simply to hide a mapping error. AD FS may need a different `groupsClaim`.
6. The example AI endpoint is internal too: replace `https://ai.company.internal/v1` and `company-model` with the real endpoint/model IDs. AI may be internal or external independently of AD. Keys live in `.env` under `apiKeyEnv`; remove that field for an upstream that truly requires no key. No per-model key duplication. For a trusted internal HTTP provider only, set `allowHttp: true`; prefer TLS.
7. `ui.theme` and `ui.branding` keep the existing Nova configuration shape; do not edit bundled HTML/CSS. Branding, theme and company model defaults are delivered after SSO. Existing user-added providers remain supported; this is **not a locked-down DLP system**.
8. Keep the internal port `8080`. Only Caddy publishes ports. Do not expose the Node port directly. If using your own reverse proxy, retain TLS, disable buffering for SSE, and allow long responses up to the configured timeout.

Issuer examples (replace all placeholders):

| Company identity | Issuer |
| --- | --- |
| AD FS | Use the exact issuer from your AD FS OpenID discovery document; confirm with IT (do not assume the host alone is correct). |
| Keycloak + internal AD | `https://sso.company.internal/realms/company` |

The server discovers the provider, validates signatures, issuer, audience, expiry, state and nonce, and exchanges codes with PKCE. Nova never receives the employee's domain password. New installs automatically include the on-prem override in `config/compose.override.yaml`. Place the trusted company CA bundle in `config/ca/company-ca.pem`, the Nova certificate chain in `config/tls/server.crt` and its private key in `config/tls/server.key`. The override sets `NODE_EXTRA_CA_CERTS` and configures Caddy to use the corporate certificate. Missing files stop the management command before deployment. Configure Keycloak's trust of the DC certificate separately. Never disable TLS verification. Single-quote secrets in `.env` when they contain `$` or `#`.

## Updates and rollback

```sh
sudo /opt/idk-nova/manage.sh check
sudo /opt/idk-nova/manage.sh update vX.Y.Z
sudo /opt/idk-nova/manage.sh rollback
```

Updates are deliberately **administrator approved**. The manager checks dedicated `server-vX.Y.Z` releases, downloads from the fixed official repository, verifies SHA-256, validates archive paths/types, builds the new image, and waits for health. A failed startup restores the previous deployment. `config/`, secrets, certificates and named volumes are preserved. Old versions/downloads are retained for recovery; IT manages retention. Checksums detect corruption, not independent publisher authenticity. Schedule `check` through company monitoring if desired; authentication itself never calls GitHub.

**Migrating from 0.31.0:** defaults/configuration are not silently rewritten. Download and verify the new Server archive, run its `install.sh` against the same installation directory, prepare/merge the on-prem override and certificates, and run `manage.sh use 0.31.4`. Existing overrides are preserved. Back up configuration before changing it; code rollback alone cannot undo an administrator's TLS/issuer changes. For isolated networks, supply Docker images/build dependencies through IT mirrors and transfer the verified archive manually; an offline one-click installer is not provided.

Existing web pages need to reload to receive new code. Server session memory is reset on restart/update, so users sign in again. No data migration or deletion is performed by the updater. Back up `/opt/idk-nova/config` securely and the Docker TLS volumes before infrastructure changes. Never use `docker compose down -v` for a routine update.

## Data, security and limits

- HTTPS, mandatory SSO, HttpOnly/Secure/SameSite cookies, fixed server-side upstreams, model allowlists, same-origin POST checks, body/concurrency/rate/time limits, no client cookies/authorization forwarded to AI providers. Sessions are opaque and stored in RAM, capped at 10,000; login attempts at 2,000 pending exchanges, expiring after 10 minutes. Session lifetime is bounded by the ID token expiry and `sessionHours`. Disabling an AD account takes effect on next sign-in/session expiry; there is no continuous directory revocation poll. Run **one instance**, not round-robin replicas, until a shared session store is implemented.
- Chat history, uploaded attachments, personal preferences and memories stay in the user's browser storage, namespaced by validated issuer + subject. **This does not provide cross-device history synchronization or encrypted browser storage.** A different browser/device starts fresh. Browser administrators can inspect local data; use separate OS/browser profiles on shared machines. SSO identity separation prevents accidental display of another account's data; it is not protection against a compromised browser or XSS.
- Company AI credentials are never included in browser configuration. A logged-in employee can use the allowed models and consume company quota. Set provider-side budgets and tenant policies; request limits are not token/cost budgets. User-provided external API providers are still possible in the normal UI.
- Only model listing and Chat Completions / Responses are proxied. Realtime voice, native Work, local GGUF import, desktop filesystem/terminal/browser control stay subject to existing web capability restrictions. Do not expose server shell execution as a workaround.
- `/auth/logout` provides a confirmation form for **local Nova sign-out**, not global directory/identity-service sign-out. The IdP may sign the user in again. Clearing browser data removes locally saved chats. `/healthz` is process health, not a provider/AD credential test.
- Logs contain generic error type/route categories, not request bodies, chat text, API keys or callback query strings. Avoid reverse-proxy access logging of `/auth/callback` query strings. Corporate audit/retention, backups, MFA, CA policy, firewall, monitoring and an external security review remain IT responsibilities.

## Acceptance test before employee rollout

Sign in with an allowed account; deny a disallowed group; verify no anonymous access; send and stream a real chat; attach a small Office/PDF file supported by the web app; test two employee accounts and two tabs with different sessions; verify company keys do not appear in browser configuration/network requests; try logout/session expiry; run an update and rollback in staging. Check TLS, mobile/narrow layout and expected concurrency. The repository tests include an actual local mock OIDC issuer with signed tokens and a streaming upstream; **they do not replace testing against your company's real AD and provider**.

Official references: [AD FS OIDC](https://learn.microsoft.com/en-us/windows-server/identity/ad-fs/development/ad-fs-openid-connect-oauth-concepts), [Keycloak AD federation](https://www.keycloak.org/docs/latest/server_admin/index.html), [openid-client](https://github.com/panva/openid-client), [Docker Compose](https://docs.docker.com/compose/), [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
