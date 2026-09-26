# IDK Nova

IDK Nova is a private, local-first AI chat application for the web and Windows.
It supports streaming conversations, images, files, voice input, searchable
history and OpenAI-compatible local or cloud models.

> Early preview: verify important responses and avoid uploading sensitive data
> to a cloud provider unless you trust that provider and understand its policy.

**Web app:** [r-winn.github.io/IDK-Nova](https://r-winn.github.io/IDK-Nova/)

## Features

- Streaming text and vision conversations
- Image, PDF, text, Markdown, JSON and CSV attachments
- Searchable local conversation history
- Rename, delete, archive, copy and share controls
- Voice input where supported by the browser
- Light/dark themes and responsive glass interface
- Multiple Ollama, LM Studio and OpenAI-compatible provider connections
- Real model discovery through each provider's `/models` endpoint
- Manual model IDs for providers that do not expose discovery
- Fast model switching with no built-in or fictional model catalogue
- Independent Tauri desktop shell for Windows

## Run locally

Requirements: Node.js 22 or newer and npm.

```bash
git clone https://github.com/r-winn/IDK-Nova.git
cd IDK-Nova
npm install
npm run dev
```

Open `http://localhost:1430`. Open **Providers & models**, add one or more
connections, and press **Discover models**. Nova lists only models reported by
the provider or exact model IDs that you add manually.

## Local providers

| Provider | Base URL |
| --- | --- |
| Ollama | `http://localhost:11434/v1` |
| LM Studio | `http://localhost:1234/v1` |

Image understanding requires a vision-capable model. Cloud API keys are kept
in memory for the current browser session and are intentionally not persisted.

### Example: local Ollama

1. Run Ollama and install a model, for example `ollama pull qwen2.5:0.5b`.
2. Add a provider with `http://localhost:11434/v1` as its base URL.
3. Leave the API key empty and select **Discover models**.
4. Select one of the returned models and save.

Each connection keeps its own real model list. You can add, rename and remove
providers, refresh installed models, add an exact model ID manually and switch
the active model from the header.

## Managed and white-label configuration

Settings includes branding, model providers, database/memory and update
management. A configuration can be exported as `idk-nova.config.json` and
imported on another installation. Secrets are removed from exported files.

Organizations can start from
[`public/idk-nova.config.example.json`](public/idk-nova.config.example.json),
rename it to `idk-nova.config.json` before building, and distribute a branded
build with the application name, workspace name, accent, logo, providers,
approved model IDs and database policy already configured. A custom logo may be
embedded as a PNG/SVG/WebP data URL. Models entered manually are tested against
the configured completion endpoint before Nova accepts them.

## Updates

`public/version.json` is the canonical release manifest. The web app is deployed
from `main` and updates on the next reload. Desktop builds compare their bundled
version with this manifest and link only to the official GitHub Release
installer. Update the application version, manifest and release tag together.

## Build

```bash
npm run build
```

Download the Windows `Setup.exe` from GitHub Releases. For a local desktop
build, install Rust and Tauri prerequisites and run `npm run desktop:build`.

## Security

Read [SECURITY.md](SECURITY.md). AI responses and uploaded content should be
treated as untrusted when used in code or automated workflows.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md). Released under the [MIT License](LICENSE).
