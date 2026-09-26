# Nova Chat

The conversational companion to Nova AI IDE. It supports streaming chat, image and file attachments, conversation history, light/dark modes, and OpenAI-compatible local or cloud models.

```bash
npm install
npm run dev
```

Open `http://localhost:1430`. Configure Ollama, LM Studio, OpenAI, or another compatible endpoint from Settings. Image understanding requires a vision-capable model.

## Windows installer

The app includes an independent Tauri desktop shell. Pushing a tag such as `chat-v0.1.0` creates a draft GitHub Release containing a standard `Setup.exe` wizard and an MSI package.

```bash
git tag chat-v0.1.0
git push origin chat-v0.1.0
```

## One-click start on macOS

Double-click `Start Nova Chat.command` in the parent project folder. The launcher prepares the app when needed, starts the local website, and opens it in the default browser. Keep the Terminal window open while using Nova Chat and press Control+C to stop it.
