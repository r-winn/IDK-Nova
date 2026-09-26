<div align="center">
  <img src="public/brand/nova-readme.jpg" width="86" alt="IDK Nova logo">
  <h1>IDK Nova</h1>
  <p><strong>Your private, configurable AI workspace for Windows and the web.</strong></p>
  <p>Connect local Ollama or LM Studio models, company AI servers, and OpenAI-compatible cloud providers from one clean desktop experience.</p>

  [![Latest release](https://img.shields.io/github/v/release/r-winn/IDK-Nova?style=flat-square&label=latest)](https://github.com/r-winn/IDK-Nova/releases/latest)
  [![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-171717?style=flat-square&logo=windows)](https://github.com/r-winn/IDK-Nova/releases/latest)
  [![Web app](https://img.shields.io/badge/Web-Open%20Nova-171717?style=flat-square)](https://r-winn.github.io/IDK-Nova/)
  [![License](https://img.shields.io/github/license/r-winn/IDK-Nova?style=flat-square)](LICENSE)
</div>

> IDK Nova is an early open-source release. Verify important AI responses and only send sensitive information to providers you trust.

## Download and use on Windows

### 1. Download Nova

Go to **[Latest Release](https://github.com/r-winn/IDK-Nova/releases/latest)** and download one of these files:

| File | Recommended for | How it works |
| --- | --- | --- |
| `IDK.Nova_*_x64-setup.exe` | Most Windows users | Opens a standard installation wizard. Click **Next**, **Install**, then **Finish**. |
| `IDK.Nova_*_x64_en-US.msi` | IT administrators and managed deployment | Windows Installer package suitable for organizational deployment tools. |

Nova currently targets 64-bit Windows 10 and Windows 11. Windows may show a SmartScreen notice because community builds are not yet code-signed. Confirm that the publisher file came from this repository's official Releases page before continuing.

The release pipeline is ready for Authenticode signing. Maintainers can follow
[WINDOWS_SIGNING.md](WINDOWS_SIGNING.md) to add an encrypted certificate to
GitHub Actions without committing private signing material.

### 2. Start an AI provider

Nova is the interface; the model runs through a provider. The easiest private option is [Ollama](https://ollama.com/).

Install Ollama, open PowerShell or Terminal, and download a lightweight model:

```powershell
ollama pull qwen2.5:0.5b
```

Ollama normally starts its local server automatically. Keep it running while using Nova.

### 3. Connect Nova to the model

1. Open **IDK Nova**.
2. Open **Settings → Models**.
3. Select the existing local provider or choose **New**.
4. Enter `http://localhost:11434/v1` as the **Base URL**.
5. Leave **API key** empty for local Ollama.
6. Choose **Connect & discover models**.
7. Select `qwen2.5:0.5b`, press **Test**, and wait for **Verified**.
8. Choose **Save changes** and start a new chat.

Nova only lists models returned by the real provider endpoint or model IDs you explicitly add. Manually entered models must answer a test completion before Nova accepts them.

## Use the web version

Open **[IDK Nova Web](https://r-winn.github.io/IDK-Nova/)**. The web app has the same provider settings and updates automatically after each published release.

Local browser connections use:

| Provider | Base URL |
| --- | --- |
| Ollama | `http://localhost:11434/v1` |
| LM Studio | `http://localhost:1234/v1` |
| OpenAI-compatible server | The `/v1` URL supplied by your administrator |

Your browser or provider must allow requests from the Nova website. The Windows desktop app is recommended when a local server blocks browser access.

## What Nova includes

- Streaming AI conversations with searchable local history
- Multiple providers and separate real model lists
- Connection discovery, completion tests, verification status, and latency
- Text, image, PDF, Markdown, JSON, and CSV attachments
- Voice input where the operating system supports it
- Local Ollama and LM Studio support
- OpenAI-compatible company and cloud endpoints
- Optional database and long-term-memory configuration
- Automatic system theme plus manual light and dark appearance
- Configurable application name, workspace name, accent color, and logo
- Managed JSON configuration for organizational distribution
- Signed in-app desktop updates with download progress and restart-to-install

Image analysis requires a vision-capable model. A text-only model such as `qwen2.5:0.5b` can chat and help with code but cannot understand an uploaded image.

## Settings guide

| Section | Purpose |
| --- | --- |
| **General** | Change the product name, workspace name, logo, accent, and response creativity. |
| **Models** | Add providers, discover installed models, test connections, and select the active model. |
| **Data & memory** | Configure PostgreSQL, MySQL, SQLite, or an HTTP data service for future memory integrations. |
| **Updates** | Check, securely download, and install signed releases without leaving the desktop app. |
| **About** | View the installed version, configuration mode, and license. |

## Organizational and white-label deployment

Nova can be prepared for a company, team, or client before distribution.

1. Copy [`public/idk-nova.config.example.json`](public/idk-nova.config.example.json).
2. Rename the copy to `idk-nova.config.json`.
3. Set the application name, workspace name, accent, approved providers, and model IDs.
4. Add a transparent PNG, SVG, or WebP logo as a data URL, or import the configuration through **Settings → Import config**.
5. Build and distribute the resulting Windows installer.

Users can also configure one installation and choose **Export config** to create a reusable file for other installations. API keys and database credentials are intentionally removed from exported files.

Example:

```json
{
  "branding": {
    "appName": "Acme AI",
    "workspaceName": "Acme Private Workspace",
    "accent": "#0f766e",
    "logoDataUrl": ""
  },
  "providers": [
    {
      "id": "company-ai",
      "name": "Company AI",
      "baseUrl": "https://ai.example.com/v1",
      "apiKey": "",
      "models": ["company-chat"]
    }
  ],
  "activeProviderId": "company-ai",
  "activeModel": "company-chat"
}
```

Do not commit real API keys or database passwords. Supply secrets separately on each device.

## Troubleshooting

### Nova cannot discover any models

- Confirm Ollama or LM Studio is running.
- Open `http://localhost:11434/v1/models` for Ollama and check that it returns JSON.
- Confirm the Base URL ends in `/v1`.
- Run `ollama list` and verify that at least one model is installed.

### Model test fails

- Confirm the exact model ID matches the provider's model list.
- Verify the API key for cloud or company providers.
- Check whether a firewall, proxy, VPN, or browser CORS policy blocks the request.
- Try the Windows desktop app to distinguish a browser restriction from a provider problem.

### The model replies poorly or cannot read images

Model quality is independent of Nova. Very small models are fast but limited. Install a larger instruction model for better reasoning, or a vision model for image understanding.

## Run from source

Requirements: Node.js 22 or newer and npm.

```bash
git clone https://github.com/r-winn/IDK-Nova.git
cd IDK-Nova
npm install
npm run dev
```

Open `http://localhost:1430`.

Production web build:

```bash
npm run build
npm run preview
```

Windows desktop build requires Rust and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/):

```bash
npm run desktop:build
```

## Updates and releases

[`public/version.json`](public/version.json) is the web release manifest. The Windows app uses Tauri's signed updater manifest (`latest.json`) generated by GitHub Actions. The website is deployed from `main`; desktop releases are built on a real Windows GitHub runner whenever a `v*` tag is pushed. Update the package version, Tauri version, web manifest, and Git tag together.

## Security

- Local provider requests stay between Nova and the configured local endpoint.
- Cloud requests go directly to the provider you configure.
- Provider credentials are stored only in the local browser profile or desktop WebView profile and are never uploaded by Nova itself.
- Exported managed configurations exclude API keys and database URLs.
- AI output and uploaded content should be treated as untrusted in code or automated workflows.

Please read [SECURITY.md](SECURITY.md) before production or organizational deployment. Report vulnerabilities privately through the process described there.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md), open an issue with reproducible details, and keep pull requests focused. The project is released under the [MIT License](LICENSE).
