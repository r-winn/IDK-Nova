# Security policy

Security fixes are provided for the latest release. Report suspected
vulnerabilities through this repository's private GitHub Security Advisory
flow rather than a public issue.

- Never commit API keys or credentials.
- Prefer local models for sensitive conversations and files.
- Cloud requests go directly to the provider configured by the user.
- Treat model responses and uploaded content as untrusted.
- Download installers only from the official GitHub Releases page.

Windows and macOS desktop builds store saved provider API keys in the native
Credential Manager / Keychain. Credentials are still present in process memory
when making provider requests. Web builds retain browser-local storage; do not
assume this provides OS-vault protection. Credential-bearing configuration
exports remain plaintext by explicit user choice.

Agent activity applies best-effort redaction of known keys and common secret
patterns. It is not a general sensitive-data classifier. Work history and memory
notes are not encrypted in this version; protect the project folder accordingly.
Remote browser tabs cannot call the native credential commands: these commands
check the invoking webview's identity and are restricted to the main UI.
