# Security policy

Security fixes are provided for the latest release. Report suspected
vulnerabilities through this repository's private GitHub Security Advisory
flow rather than a public issue.

- Never commit API keys or credentials.
- Prefer local models for sensitive conversations and files.
- Cloud requests go directly to the provider configured by the user.
- Treat model responses and uploaded content as untrusted.
- Download installers only from the official GitHub Releases page.
