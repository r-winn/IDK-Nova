# Nova Server 0.31.4 · Minimal English sign-in

- Frameless login: icon, username, password, Remember me and Sign in. No language/theme selectors, promotional footer or card background.
- Automatic OS light/dark theme with subtle animated workspace-like gradients and reduced-motion support.
- English-only preview, including legacy Persian/theme URLs. Company configuration defaults to `oidc.uiLocales: "en"`.
- Native Keycloak authentication, error messages and mandatory security challenges are preserved.

Existing deployments: install/select the updated `nova` Keycloak theme, disable realm internationalization (or support only English), set Nova's `oidc.uiLocales` to `en`, and enable realm **Remember me** only with approved session lifetimes. Existing company configurations and live realm policies are never silently rewritten.

[IT installation guide](https://github.com/r-winn/IDK-Nova/blob/server-v0.31.4/server/keycloak/README.fa.md)

The local visual preview is not authentication and does not accept credentials. Desktop app/UI version remains 0.31.0; this is an independent Linux Server bundle.
