# IDK Nova

IDK Nova is a private, local-first AI chat application for the web and Windows.
It supports streaming conversations, images, files, voice input, searchable
history and OpenAI-compatible local or cloud models.

> Early preview: verify important responses and avoid uploading sensitive data
> to a cloud provider unless you trust that provider and understand its policy.

## Features

- Streaming text and vision conversations
- Image, PDF, text, Markdown, JSON and CSV attachments
- Searchable local conversation history
- Rename, delete, archive, copy and share controls
- Voice input where supported by the browser
- Light/dark themes and responsive glass interface
- Ollama, LM Studio and OpenAI-compatible providers
- Independent Tauri desktop shell for Windows

## Run locally

Requirements: Node.js 22 or newer and npm.

```bash
git clone https://github.com/r-winn/IDK-Nova.git
cd IDK-Nova
npm install
npm run dev
```

Open `http://localhost:1430`. Configure the provider and vision model from the
Settings button.

## Local providers

| Provider | Base URL |
| --- | --- |
| Ollama | `http://localhost:11434/v1` |
| LM Studio | `http://localhost:1234/v1` |

Image understanding requires a vision-capable model. Cloud API keys are kept
in memory for the current browser session and are intentionally not persisted.

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
