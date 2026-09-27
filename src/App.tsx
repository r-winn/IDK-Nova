import {
  ChangeEvent,
  CSSProperties,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Archive,
  ArrowRight,
  ArrowUp,
  Bot,
  BookOpen,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Code2,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileText,
  Folder,
  FolderPlus,
  FlaskConical,
  Globe2,
  HardDriveUpload,
  Heart,
  Image as ImageIcon,
  Info,
  Maximize2,
  Menu,
  MessageSquare,
  Mic,
  Minimize2,
  MoreHorizontal,
  PanelLeftClose,
  PanelRight,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Reply,
  Rocket,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Square,
  Trash2,
  Upload,
  GraduationCap,
  Workflow,
  X,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { discoverModels, streamCompletion, testModel } from "./lib/ai";
import {
  loadConfig,
  loadManagedConfig,
  loadValue,
  saveChats,
  saveConfig,
} from "./lib/storage";
import {
  Attachment,
  Chat,
  ChatFolder,
  Config,
  Message,
  Provider,
  getActiveProvider,
} from "./types";
import {
  APP_VERSION,
  UPDATE_MANIFEST,
  UpdateManifest,
  isNewerVersion,
} from "./version";
import {
  DownloadProgress,
  NativeUpdate,
  downloadNativeUpdate,
  findNativeUpdate,
  installNativeUpdate,
  isDesktopApp,
} from "./lib/updater";
import { BrandMark } from "./components/BrandMark";
import { ThemeSelector } from "./components/ThemeSelector";

const starterChats: Chat[] = [
  { id: 1, title: "Welcome to Nova", time: "Today", messages: [] },
];
const settingMeta = {
  general: ["General", "Personalize Nova and choose how it looks."],
  models: [
    "Models & providers",
    "Connect only the AI services you trust and use.",
  ],
  data: ["Data & memory", "Control optional storage and long-term context."],
  updates: ["Software update", "Keep Nova secure and up to date."],
  about: ["About Nova", "Version, licensing and deployment details."],
} as const;
type SettingsTab = keyof typeof settingMeta;
type ChatDialog = {
  mode: "rename" | "delete";
  id: number;
  value: string;
} | null;
type FolderDialog = { mode: "create" | "rename"; id?: string; name: string; color: string; icon: ChatFolder["icon"] } | null;
type ChatMenu = { chatId: number; x: number; y: number } | null;
type SelectionToolbar = { text: string; x: number; y: number } | null;
type Artifact = { title: string; language: string; content: string } | null;
type BrowserTab = { id: string; title: string; url: string; input: string; history: string[]; historyIndex: number };
type NativeBrowserView = { webview: Webview; url: string; frameKey: number };

const folderIcons = {
  folder: Folder,
  work: BriefcaseBusiness,
  code: Code2,
  sparkles: Sparkles,
  book: BookOpen,
  heart: Heart,
  star: Star,
  rocket: Rocket,
  lab: FlaskConical,
  study: GraduationCap,
};
const folderColors = ["#5b8def", "#8b5cf6", "#c65fd4", "#e8793e", "#e8ad3e", "#2aa876", "#24a6a8", "#d4546a", "#64748b", "#1f2937"];
const splitContent = (content: string) => {
  const parts: { type: "text" | "code"; content: string; language: string }[] = [];
  const pattern = /```([\w+-]*)\n([\s\S]*?)```/g;
  let cursor = 0;
  for (const match of content.matchAll(pattern)) {
    if (match.index! > cursor) parts.push({ type: "text", content: content.slice(cursor, match.index), language: "" });
    parts.push({ type: "code", content: match[2].replace(/\n$/, ""), language: match[1] || "code" });
    cursor = match.index! + match[0].length;
  }
  if (cursor < content.length) parts.push({ type: "text", content: content.slice(cursor), language: "" });
  return parts.length ? parts : [{ type: "text" as const, content, language: "" }];
};

export default function App() {
  const [sidebar, setSidebar] = useState(true);
  const [active, setActive] = useState(() => loadValue("idk-nova-active", 1));
  const [chats, setChats] = useState<Chat[]>(() => {
    const stored = loadValue<Chat[]>("idk-nova-history", starterChats);
    if (!Array.isArray(stored)) return starterChats;
    const valid = stored
      .filter((item): item is Chat =>
        Boolean(
          item && typeof item.id === "number" && typeof item.title === "string",
        ),
      )
      .map((item) => ({
        ...item,
        messages: Array.isArray(item.messages) ? item.messages : [],
      }));
    return valid.length ? valid : starterChats;
  });
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(() =>
    new URLSearchParams(location.search).has("settings"),
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  const [chatDialog, setChatDialog] = useState<ChatDialog>(null);
  const [folders, setFolders] = useState<ChatFolder[]>(() => loadValue("idk-nova-folders", []));
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [folderDialog, setFolderDialog] = useState<FolderDialog>(null);
  const [chatMenu, setChatMenu] = useState<ChatMenu>(null);
  const [selectionToolbar, setSelectionToolbar] = useState<SelectionToolbar>(null);
  const [replyQuote, setReplyQuote] = useState("");
  const [artifact, setArtifact] = useState<Artifact>(null);
  const [artifactDraft, setArtifactDraft] = useState("");
  const [artifactTab, setArtifactTab] = useState<"edit" | "preview">("edit");
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([{ id: "start", title: "New tab", url: "", input: "", history: [], historyIndex: -1 }]);
  const [activeBrowserTabId, setActiveBrowserTabId] = useState("start");
  const [browserFrameKey, setBrowserFrameKey] = useState(0);
  const [browserWidth, setBrowserWidth] = useState(() => loadValue<number>("idk-nova-browser-width", 560));
  const [browserMaximized, setBrowserMaximized] = useState(false);
  const [importingLocalModel, setImportingLocalModel] = useState(false);
  const [listening, setListening] = useState(false);
  const [config, setConfig] = useState<Config>(loadConfig);
  const [draftConfig, setDraftConfig] = useState<Config>(config);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [syncingId, setSyncingId] = useState("");
  const [manualModel, setManualModel] = useState("");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [testingModel, setTestingModel] = useState("");
  const [verifiedModels, setVerifiedModels] = useState<Record<string, number>>(
    {},
  );
  const [updateState, setUpdateState] = useState<
    "idle" | "checking" | "latest" | "available" | "error"
  >("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateManifest | null>(null);
  const [nativeUpdate, setNativeUpdate] = useState<NativeUpdate | null>(null);
  const [downloadProgress, setDownloadProgress] =
    useState<DownloadProgress | null>(null);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null),
    endRef = useRef<HTMLDivElement>(null),
    configFileRef = useRef<HTMLInputElement>(null),
    logoFileRef = useRef<HTMLInputElement>(null),
    browserSurfaceRef = useRef<HTMLDivElement>(null),
    nativeBrowserViewsRef = useRef<Map<string, NativeBrowserView>>(new Map()),
    abortRef = useRef<AbortController | null>(null);
  const chat = chats.find((item) => item.id === active) || chats[0];
  const activeProvider = getActiveProvider(config),
    activeDraftProvider = getActiveProvider(draftConfig);
  const activeBrowserTab = browserTabs.find((tab) => tab.id === activeBrowserTabId) || browserTabs[0];
  const visibleChats = useMemo(
    () =>
      chats.filter(
        (item) =>
          !item.archived &&
          !item.folderId &&
          item.title.toLowerCase().includes(query.toLowerCase()),
      ),
    [chats, query],
  );
  const resolvedDark =
    config.theme === "system" ? systemDark : config.theme === "dark";
  const toastIsError =
    /failed|could not|couldn.t|cannot|invalid|error|rejected|not found|no models|unavailable|not supported|only be imported|must be installed|choose a valid|choose an image|add at least|before sending/i.test(
      toast,
    );

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const change = () => setSystemDark(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedDark ? "dark" : "light";
  }, [resolvedDark]);
  useEffect(() => {
    saveChats(chats);
  }, [chats]);
  useEffect(() => {
    localStorage.setItem("idk-nova-folders", JSON.stringify(folders));
  }, [folders]);
  useEffect(() => {
    localStorage.setItem("idk-nova-browser-width", JSON.stringify(browserWidth));
  }, [browserWidth]);
  useEffect(() => {
    const adaptBrowser = () => {
      if (!browserOpen || browserMaximized) return;
      const available = window.innerWidth - (sidebar ? 272 : 0);
      if (available < 860) setBrowserMaximized(true);
      else setBrowserWidth((width) => Math.min(width, available - 430));
    };
    window.addEventListener("resize", adaptBrowser);
    return () => window.removeEventListener("resize", adaptBrowser);
  }, [browserOpen, browserMaximized, sidebar]);
  useEffect(() => {
    if (!isDesktopApp()) return;
    let cancelled = false;
    const syncNativeBrowser = async () => {
      const views = nativeBrowserViewsRef.current;
      for (const [id, entry] of views) {
        if (!browserOpen || id !== activeBrowserTabId) await entry.webview.hide().catch(() => undefined);
      }
      if (!browserOpen || !activeBrowserTab?.url || !browserSurfaceRef.current) return;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (cancelled || !browserSurfaceRef.current) return;
      const rect = browserSurfaceRef.current.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height - 34);
      let entry = views.get(activeBrowserTabId);
      if (entry && (entry.url !== activeBrowserTab.url || entry.frameKey !== browserFrameKey)) {
        await entry.webview.close().catch(() => undefined);
        views.delete(activeBrowserTabId);
        entry = undefined;
      }
      if (!entry) {
        const label = `nova-browser-${activeBrowserTabId}-${browserFrameKey}`.replace(/[^a-zA-Z0-9-/:_]/g, "-");
        const webview = new Webview(getCurrentWindow(), label, {
          url: activeBrowserTab.url,
          x: rect.left,
          y: rect.top,
          width,
          height,
        });
        entry = { webview, url: activeBrowserTab.url, frameKey: browserFrameKey };
        views.set(activeBrowserTabId, entry);
      } else {
        await entry.webview.setPosition(new LogicalPosition(rect.left, rect.top)).catch(() => undefined);
        await entry.webview.setSize(new LogicalSize(width, height)).catch(() => undefined);
        await entry.webview.show().catch(() => undefined);
      }
    };
    syncNativeBrowser().catch(() => setToast("This page could not be opened inside Nova"));
    return () => { cancelled = true; };
  }, [browserOpen, activeBrowserTabId, activeBrowserTab?.url, browserFrameKey, browserWidth, browserMaximized]);
  useEffect(() => () => {
    for (const entry of nativeBrowserViewsRef.current.values()) entry.webview.close().catch(() => undefined);
  }, []);
  useEffect(
    () => {
      localStorage.setItem("idk-nova-active", JSON.stringify(active));
    },
    [active],
  );
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat?.messages, busy]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2400);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    loadManagedConfig().then((managed) => {
      if (!managed) return;
      setConfig((current) => {
        const next = {
          ...current,
          ...managed,
          branding: { ...current.branding, ...managed.branding },
          database: { ...current.database, ...managed.database },
        } as Config;
        saveConfig(next);
        return next;
      });
    });
  }, []);

  const prepareAttachment = (file: File): Promise<Attachment> =>
    new Promise((resolve, reject) => {
      if (!file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = () => resolve({ name: file.name, type: file.type, url: String(reader.result) });
        reader.onerror = () => reject(new Error("Could not read the selected file"));
        reader.readAsDataURL(file);
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read the selected image"));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error("Choose a valid image"));
        image.onload = () => {
          const scale = Math.min(1, 1024 / Math.max(image.width, image.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve({ name: file.name, type: "image/jpeg", url: canvas.toDataURL("image/jpeg", 0.72) });
        };
        image.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = [...(event.target.files || [])].slice(0, 5);
    event.target.value = "";
    try {
      const selected = await Promise.all(selectedFiles.map(prepareAttachment));
      setFiles((current) => [...current, ...selected].slice(0, 5));
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not prepare the attachment");
    }
  };
  const fresh = () => {
    const id = Date.now();
    setChats((current) => [
      { id, title: "New conversation", time: "Today", messages: [] },
      ...current,
    ]);
    setActive(id);
    setText("");
  };
  const requestDeleteChat = (id: number) =>
    setChatDialog({
      mode: "delete",
      id,
      value: chats.find((item) => item.id === id)?.title || "this conversation",
    });
  const requestRenameChat = (id: number) =>
    setChatDialog({
      mode: "rename",
      id,
      value: chats.find((item) => item.id === id)?.title || "",
    });
  const saveFolder = () => {
    if (!folderDialog?.name.trim()) return;
    if (folderDialog.mode === "create") {
      const folder: ChatFolder = {
        id: `folder-${Date.now()}`,
        name: folderDialog.name.trim(),
        color: folderDialog.color,
        icon: folderDialog.icon,
      };
      setFolders((current) => [...current, folder]);
      setOpenFolderId(folder.id);
      setFoldersOpen(false);
    } else {
      setFolders((current) => current.map((folder) => folder.id === folderDialog.id ? { ...folder, name: folderDialog.name.trim(), color: folderDialog.color, icon: folderDialog.icon } : folder));
    }
    setFolderDialog(null);
  };
  const deleteFolder = (id: string) => {
    setFolders((current) => current.filter((folder) => folder.id !== id));
    setChats((current) => current.map((item) => item.folderId === id ? { ...item, folderId: undefined } : item));
    if (openFolderId === id) setOpenFolderId(null);
    setToast("Folder removed · conversations kept");
  };
  const moveChat = (chatId: number, folderId?: string) => {
    setChats((current) => current.map((item) => item.id === chatId ? { ...item, folderId } : item));
    setChatMenu(null);
    setToast(folderId ? "Conversation moved" : "Removed from folder");
  };
  const confirmChatDialog = () => {
    if (!chatDialog) return;
    if (chatDialog.mode === "delete") {
      const next = chats.filter((item) => item.id !== chatDialog.id);
      setChats(next.length ? next : starterChats);
      if (active === chatDialog.id) setActive(next[0]?.id || 1);
      setToast("Conversation deleted");
    } else if (chatDialog.value.trim()) {
      setChats((items) =>
        items.map((item) =>
          item.id === chatDialog.id
            ? { ...item, title: chatDialog.value.trim() }
            : item,
        ),
      );
      setToast("Conversation renamed");
    }
    setChatDialog(null);
  };
  const archiveChat = (id: number) => {
    setChats((items) =>
      items.map((item) =>
        item.id === id ? { ...item, archived: true } : item,
      ),
    );
    fresh();
    setToast("Conversation archived");
  };
  const share = async () => {
    const transcript = chat.messages
      .map(
        (message) =>
          `${message.role === "user" ? "You" : "Nova"}: ${message.content}`,
      )
      .join("\n\n");
    try {
      if (navigator.share)
        await navigator.share({ title: chat.title, text: transcript });
      else {
        await navigator.clipboard.writeText(transcript);
        setToast("Conversation copied");
      }
    } catch {
      /* cancelled */
    }
  };
  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setToast("Copied to clipboard");
  };
  const captureSelection = (container: HTMLElement) => {
    requestAnimationFrame(() => {
      const selection = window.getSelection();
      const text = selection?.toString().trim() || "";
      if (!selection || selection.rangeCount === 0 || !text || !container.contains(selection.anchorNode)) {
        setSelectionToolbar(null);
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      setSelectionToolbar({
        text: text.slice(0, 4000),
        x: Math.max(86, Math.min(window.innerWidth - 86, rect.left + rect.width / 2)),
        y: Math.max(54, rect.top - 10),
      });
    });
  };
  const replyToSelection = (value: string) => {
    setReplyQuote(value);
    setSelectionToolbar(null);
    window.getSelection()?.removeAllRanges();
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus());
  };
  const openArtifact = (title: string, language: string, content: string) => {
    setBrowserOpen(false);
    setArtifact({ title, language, content });
    setArtifactDraft(content);
    setArtifactTab(language.toLowerCase() === "html" ? "preview" : "edit");
  };
  const normalizeBrowserTarget = (value: string) => {
    const target = value.trim();
    if (!target) return "";
    if (/^https?:\/\//i.test(target)) return target;
    if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(target)) return `https://${target}`;
    return `https://www.google.com/search?igu=1&q=${encodeURIComponent(target)}`;
  };
  const navigateBrowser = (value: string, openInNewTab = false) => {
    const target = normalizeBrowserTarget(value);
    if (!target) return;
    setArtifact(null);
    let title = "Search";
    try { title = new URL(target).hostname.replace(/^www\./, "") || "Search"; } catch { /* search URL */ }
    if (openInNewTab && activeBrowserTab?.url) {
      const id = `tab-${Date.now()}`;
      setBrowserTabs((tabs) => [...tabs, { id, title, url: target, input: target, history: [target], historyIndex: 0 }]);
      setActiveBrowserTabId(id);
    } else {
      setBrowserTabs((tabs) => tabs.map((tab) => {
        if (tab.id !== activeBrowserTabId) return tab;
        const history = [...tab.history.slice(0, tab.historyIndex + 1), target];
        return { ...tab, title, url: target, input: target, history, historyIndex: history.length - 1 };
      }));
    }
    setBrowserFrameKey((key) => key + 1);
    const available = window.innerWidth - (sidebar ? 272 : 0);
    if (available < 860) setBrowserMaximized(true);
    else setBrowserWidth((width) => Math.min(width, available - 430));
    setBrowserOpen(true);
  };
  const openSystemBrowser = async () => {
    if (!activeBrowserTab?.url) return;
    if (isDesktopApp()) await openUrl(activeBrowserTab.url);
    else window.open(activeBrowserTab.url, "_blank", "noopener,noreferrer");
  };
  const updateBrowserInput = (input: string) => setBrowserTabs((tabs) => tabs.map((tab) => tab.id === activeBrowserTabId ? { ...tab, input } : tab));
  const addBrowserTab = () => {
    const id = `tab-${Date.now()}`;
    setBrowserTabs((tabs) => [...tabs, { id, title: "New tab", url: "", input: "", history: [], historyIndex: -1 }]);
    setActiveBrowserTabId(id);
  };
  const closeBrowserTab = (id: string) => {
    const nativeView = nativeBrowserViewsRef.current.get(id);
    if (nativeView) {
      nativeView.webview.close().catch(() => undefined);
      nativeBrowserViewsRef.current.delete(id);
    }
    setBrowserTabs((tabs) => {
      if (tabs.length === 1) return [{ id: "start", title: "New tab", url: "", input: "", history: [], historyIndex: -1 }];
      const index = tabs.findIndex((tab) => tab.id === id);
      const next = tabs.filter((tab) => tab.id !== id);
      if (id === activeBrowserTabId) setActiveBrowserTabId(next[Math.max(0, index - 1)].id);
      return next;
    });
  };
  const moveBrowserHistory = (direction: -1 | 1) => {
    setBrowserTabs((tabs) => tabs.map((tab) => {
      if (tab.id !== activeBrowserTabId) return tab;
      const historyIndex = tab.historyIndex + direction;
      if (historyIndex < 0 || historyIndex >= tab.history.length) return tab;
      const url = tab.history[historyIndex];
      return { ...tab, url, input: url, historyIndex };
    }));
    setBrowserFrameKey((key) => key + 1);
  };
  const startBrowserResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const originX = event.clientX;
    const reservedForChat = (sidebar ? 272 : 0) + 430;
    const largestSplit = Math.max(420, window.innerWidth - reservedForChat);
    const originWidth = browserMaximized ? largestSplit + 36 : browserWidth;
    if (browserMaximized) setBrowserMaximized(false);
    const resize = (moveEvent: PointerEvent) => {
      const requested = originWidth + originX - moveEvent.clientX;
      if (requested >= largestSplit + 36) {
        setBrowserMaximized(true);
        return;
      }
      setBrowserMaximized(false);
      setBrowserWidth(Math.max(420, Math.min(requested, largestSplit)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stop);
      document.body.classList.remove("resizing-browser");
    };
    document.body.classList.add("resizing-browser");
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop);
  };
  const downloadArtifact = () => {
    if (!artifact) return;
    const extension = ({ javascript: "js", typescript: "ts", python: "py", html: "html", css: "css", json: "json", text: "txt" } as Record<string, string>)[artifact.language.toLowerCase()] || "txt";
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([artifactDraft], { type: "text/plain" }));
    link.download = `nova-artifact.${extension}`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const toggleVoice = () => {
    const Recognition = (
      window as typeof window & { webkitSpeechRecognition?: new () => any }
    ).webkitSpeechRecognition;
    if (!Recognition) {
      setToast("Voice input is not supported here");
      return;
    }
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onresult = (event: any) =>
      setText(
        Array.from(event.results)
          .map((result: any) => result[0].transcript)
          .join(""),
      );
    recognition.start();
  };
  const send = async () => {
    if (!activeProvider || !config.activeModel) {
      setToast("Connect and select a model before sending a message");
      setDraftConfig(config);
      setSettingsTab("models");
      setSettingsOpen(true);
      return;
    }
    if ((!text.trim() && !files.length) || busy || !chat) return;
    const user: Message = {
      role: "user",
      content: text.trim(),
      attachments: files,
      quote: replyQuote || undefined,
    };
    const title = chat.messages.length
      ? chat.title
      : (text.trim() || "Image conversation").slice(0, 36);
    setChats((items) =>
      items.map((item) =>
        item.id === active
          ? {
              ...item,
              title,
              messages: [
                ...item.messages,
                user,
                { role: "assistant", content: "" },
              ],
            }
          : item,
      ),
    );
    setText("");
    setFiles([]);
    setReplyQuote("");
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamCompletion(config, [...chat.messages, user], (token) =>
        setChats((items) =>
          items.map((item) =>
            item.id === active
              ? {
                  ...item,
                  messages: item.messages.map((message, index) =>
                    index === item.messages.length - 1
                      ? { ...message, content: message.content + token }
                      : message,
                  ),
                }
              : item,
          ),
        ), controller.signal,
      );
    } catch (error) {
      if (controller.signal.aborted) {
        setChats((items) => items.map((item) => item.id === active ? {
          ...item,
          messages: item.messages.map((message, index) => index === item.messages.length - 1 && !message.content ? { ...message, content: "Response stopped." } : message),
        } : item));
        return;
      }
      setChats((items) =>
        items.map((item) =>
          item.id === active
            ? {
                ...item,
                messages: item.messages.map((message, index) =>
                  index === item.messages.length - 1
                    ? {
                        ...message,
                        content: `I couldn’t connect to ${config.activeModel || "the selected model"}. Check Settings and make sure the provider is running.\n\n${error instanceof Error ? error.message : "Unknown error"}`,
                      }
                    : message,
                ),
              }
            : item,
        ),
      );
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };
  const stopResponse = () => abortRef.current?.abort();
  const key = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };
  const openSettings = () => {
    setDraftConfig(config);
    setSettingsOpen(true);
    setModelOpen(false);
  };
  const updateDraftProvider = (changes: Partial<Provider>) =>
    setDraftConfig((current) => ({
      ...current,
      providers: current.providers.map((provider) =>
        provider.id === current.activeProviderId
          ? { ...provider, ...changes }
          : provider,
      ),
    }));
  const addProvider = () => {
    const id = `provider-${Date.now()}`;
    const provider: Provider = {
      id,
      name: "New provider",
      baseUrl: "",
      apiKey: "",
      models: [],
    };
    setDraftConfig((current) => ({
      ...current,
      providers: [...current.providers, provider],
      activeProviderId: id,
      activeModel: "",
    }));
  };
  const removeProvider = (id: string) =>
    setDraftConfig((current) => {
      const providers = current.providers.filter(
        (provider) => provider.id !== id,
      );
      const next = providers[0];
      return {
        ...current,
        providers,
        activeProviderId: next?.id || "",
        activeModel: next?.models[0] || "",
      };
    });
  const refreshModels = async () => {
    if (!activeDraftProvider?.baseUrl) return;
    setSyncingId(activeDraftProvider.id);
    try {
      const models = await discoverModels(activeDraftProvider);
      updateDraftProvider({ models });
      setDraftConfig((current) => ({
        ...current,
        activeModel: models.includes(current.activeModel)
          ? current.activeModel
          : models[0] || "",
      }));
      setToast(
        models.length
          ? `${models.length} real model${models.length === 1 ? "" : "s"} found`
          : "Provider returned no models",
      );
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "Could not load models",
      );
    } finally {
      setSyncingId("");
    }
  };
  const addManualModel = async () => {
    const model = manualModel.trim();
    if (!model || !activeDraftProvider) return;
    setTestingModel(model);
    try {
      const latency = await testModel(activeDraftProvider, model);
      updateDraftProvider({
        models: [...new Set([...activeDraftProvider.models, model])],
      });
      setDraftConfig((current) => ({ ...current, activeModel: model }));
      setVerifiedModels((current) => ({
        ...current,
        [`${activeDraftProvider.id}:${model}`]: latency,
      }));
      setManualModel("");
      setToast(`Model accepted · ${latency} ms`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Model rejected");
    } finally {
      setTestingModel("");
    }
  };
  const verifyModel = async (model: string) => {
    if (!activeDraftProvider) return;
    setTestingModel(model);
    try {
      const latency = await testModel(activeDraftProvider, model);
      setVerifiedModels((current) => ({
        ...current,
        [`${activeDraftProvider.id}:${model}`]: latency,
      }));
      setToast(`Model verified in ${latency} ms`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Model test failed");
    } finally {
      setTestingModel("");
    }
  };
  const importLocalModel = async () => {
    if (!isDesktopApp()) {
      setToast("Local model files can only be imported in the desktop app");
      return;
    }
    const selected = await open({
      multiple: false,
      filters: [{ name: "GGUF model", extensions: ["gguf"] }],
    });
    if (!selected) return;
    setImportingLocalModel(true);
    try {
      const model = await invoke<string>("import_gguf_model", {
        sourcePath: selected,
        modelName: "",
      });
      const existing = draftConfig.providers.find((provider) =>
        /localhost:11434|127\.0\.0\.1:11434/.test(provider.baseUrl),
      );
      const providerId = existing?.id || `ollama-import-${Date.now()}`;
      const providers = existing
        ? draftConfig.providers.map((provider) =>
            provider.id === existing.id
              ? {
                  ...provider,
                  models: [...new Set([...provider.models, model])],
                }
              : provider,
          )
        : [
            ...draftConfig.providers,
            {
              id: providerId,
              name: "Ollama Local",
              baseUrl: "http://localhost:11434/v1",
              apiKey: "",
              models: [model],
            },
          ];
      setDraftConfig((current) => ({
        ...current,
        providers,
        activeProviderId: providerId,
        activeModel: model,
      }));
      setToast(`${model} imported and ready`);
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "Local model import failed",
      );
    } finally {
      setImportingLocalModel(false);
    }
  };
  const checkUpdates = async () => {
    setUpdateState("checking");
    setUpdateError("");
    setUpdateDownloaded(false);
    setDownloadProgress(null);
    try {
      if (isDesktopApp()) {
        const update = await findNativeUpdate();
        setNativeUpdate(update);
        if (update) {
          setUpdateInfo({
            version: update.version,
            releaseUrl: "",
            installerUrl: "",
            notes: update.body ? update.body.split("\n").filter(Boolean) : [],
          });
          setUpdateState("available");
        } else setUpdateState("latest");
        return;
      }
      const response = await fetch(`${UPDATE_MANIFEST}?t=${Date.now()}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error();
      const manifest: UpdateManifest = await response.json();
      setUpdateInfo(manifest);
      setUpdateState(
        isNewerVersion(manifest.version, APP_VERSION) ? "available" : "latest",
      );
    } catch (error) {
      setUpdateError(
        error instanceof Error ? error.message : "Could not check for updates",
      );
      setUpdateState("error");
    }
  };
  const downloadUpdate = async () => {
    if (!nativeUpdate) return;
    setUpdateError("");
    setDownloadProgress({ percent: 0, downloaded: 0, total: 0 });
    try {
      await downloadNativeUpdate(nativeUpdate, setDownloadProgress);
      setDownloadProgress((current) => ({
        downloaded: current?.downloaded || 0,
        total: current?.total || 0,
        percent: 100,
      }));
      setUpdateDownloaded(true);
    } catch (error) {
      setUpdateError(
        error instanceof Error ? error.message : "Update download failed",
      );
      setDownloadProgress(null);
    }
  };
  const restartAndInstall = async () => {
    if (!nativeUpdate || !updateDownloaded) return;
    try {
      await installNativeUpdate(nativeUpdate);
    } catch (error) {
      setUpdateError(
        error instanceof Error ? error.message : "Could not install the update",
      );
    }
  };
  const importConfig = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const value = JSON.parse(String(reader.result));
        setDraftConfig((current) => ({
          ...current,
          ...value,
          branding: { ...current.branding, ...value.branding },
          database: { ...current.database, ...value.database },
        }));
        setToast("Configuration imported");
      } catch {
        setToast("Invalid configuration file");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };
  const exportConfig = () => {
    const safe = {
      ...draftConfig,
      providers: draftConfig.providers.map((provider) => ({
        ...provider,
        apiKey: "",
      })),
      database: { ...draftConfig.database, url: "" },
    };
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([JSON.stringify(safe, null, 2)], { type: "application/json" }),
    );
    link.download = "idk-nova.config.json";
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const uploadLogo = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || file.size > 2_000_000) {
      setToast("Choose an image under 2 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      setDraftConfig((current) => ({
        ...current,
        branding: { ...current.branding, logoDataUrl: String(reader.result) },
      }));
    reader.readAsDataURL(file);
    event.target.value = "";
  };
  const saveSettings = () => {
    if (!draftConfig.providers.length) {
      setToast("Add at least one provider");
      return;
    }
    setConfig(draftConfig);
    saveConfig(draftConfig);
    setSettingsOpen(false);
    setToast("Settings saved");
  };
  const activeFolder = folders.find((folder) => folder.id === openFolderId);
  const freshInFolder = () => {
    if (!activeFolder) return fresh();
    const id = Date.now();
    setChats((current) => [
      { id, title: "New conversation", time: "Today", messages: [], folderId: activeFolder.id },
      ...current,
    ]);
    setActive(id);
    setText("");
  };
  const renderChatRows = (items: Chat[]) => ["Today", "Yesterday", "Previous 7 days"].map((group) => (
    <section key={group}>
      <h5>{group}</h5>
      {items.filter((item) => item.time === group).map((item) => (
        <div
          className={`chat-row ${active === item.id ? "active" : ""}`}
          key={item.id}
          onContextMenu={(event) => {
            event.preventDefault();
            setChatMenu({ chatId: item.id, x: event.clientX, y: event.clientY });
          }}
        >
          <button className="chat-select" onClick={() => setActive(item.id)}>
            <MessageSquare />
            <span>{item.title}</span>
          </button>
          <div className="row-actions">
            <button
              title="Conversation options"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setChatMenu({ chatId: item.id, x: rect.right, y: rect.bottom });
              }}
            ><MoreHorizontal /></button>
          </div>
        </div>
      ))}
    </section>
  ));
  const renderMessageContent = (message: Message) => (
    <div
      className="rich-content"
      dir="auto"
      onMouseUp={(event) => captureSelection(event.currentTarget)}
    >
      {splitContent(message.content).map((part, index) => part.type === "code" ? (
        <section className="code-artifact" key={index} dir="ltr">
          <header>
            <span><Code2 />{part.language}</span>
            <div>
              <button onClick={() => copy(part.content)}><Copy />Copy</button>
              <button onClick={() => openArtifact(`${part.language} artifact`, part.language, part.content)}><Maximize2 />Open</button>
            </div>
          </header>
          <pre><code>{part.content}</code></pre>
        </section>
      ) : (
        <span className="prose-segment" key={index}>
          {part.content.split(/(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s<)]+)/g).map((piece, pieceIndex) => {
            const markdownLink = piece.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
            const target = markdownLink?.[2] || (/^https?:\/\//i.test(piece) ? piece : "");
            return target ? <a href={target} key={pieceIndex} onClick={(event) => { event.preventDefault(); navigateBrowser(target, true); }}>{markdownLink?.[1] || piece}</a> : piece;
          })}
        </span>
      ))}
    </div>
  );
  if (!chat) return null;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebar ? "" : "collapsed"}`}>
        <div className="sidebar-head">
          <div className="brand-lockup">
            <BrandMark config={config} />
            <b>{config.branding.appName}</b>
          </div>
          <button
            className="icon-button"
            aria-label="Close sidebar"
            onClick={() => setSidebar(false)}
          >
            <PanelLeftClose />
          </button>
        </div>
        <div className="sidebar-stage">
          <div className={`sidebar-track ${activeFolder ? "inside-folder" : ""}`}>
            <div className="sidebar-panel sidebar-main">
              <div className="primary-nav">
                <button onClick={fresh}>
                  <Pencil />
                  <span>New chat</span>
                  <kbd>⌘ K</kbd>
                </button>
                <button onClick={() => setFoldersOpen(!foldersOpen)}>
                  <Folder />
                  <span>Folder</span>
                  <ChevronRight className={foldersOpen ? "open" : ""} />
                </button>
                  <div className={`folder-list ${foldersOpen ? "open" : ""}`} aria-hidden={!foldersOpen}>
                    <div className="folder-heading">
                      <span>Your folders</span>
                      <button title="New folder" onClick={() => setFolderDialog({ mode: "create", name: "", color: folderColors[0], icon: "folder" })}><FolderPlus /></button>
                    </div>
                    {folders.map((folder) => {
                      const Icon = folderIcons[folder.icon];
                      return (
                        <div className="folder-row" key={folder.id}>
                          <button onClick={() => { setOpenFolderId(folder.id); setFoldersOpen(false); }}>
                            <Icon style={{ color: folder.color }} />
                            <span>{folder.name}</span>
                            <small>{chats.filter((item) => item.folderId === folder.id && !item.archived).length}</small>
                          </button>
                          <button className="folder-edit" title="Edit folder" onClick={() => setFolderDialog({ mode: "rename", ...folder })}><MoreHorizontal /></button>
                        </div>
                      );
                    })}
                    {!folders.length && <button className="empty-folder-action" onClick={() => setFolderDialog({ mode: "create", name: "", color: folderColors[0], icon: "folder" })}><FolderPlus /><span>Create your first folder</span></button>}
                  </div>
                <button onClick={() => setSearchOpen(!searchOpen)}>
                  <Search />
                  <span>Search</span>
                </button>
                <span className="nav-tooltip">
                  <button disabled><BriefcaseBusiness /><span>Work</span><small>Soon</small></button>
                  <i>Coming soon</i>
                </span>
                <span className="nav-tooltip">
                  <button disabled><Workflow /><span>Agents</span><small>Soon</small></button>
                  <i>Coming soon</i>
                </span>
              </div>
              {searchOpen && (
                <div className="search-field">
                  <Search />
                  <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" />
                  <button onClick={() => { setQuery(""); setSearchOpen(false); }}><X /></button>
                </div>
              )}
              <div className="history">{renderChatRows(visibleChats)}</div>
            </div>
            <div className="sidebar-panel folder-view">
              {activeFolder && (() => {
                const Icon = folderIcons[activeFolder.icon];
                const folderChats = chats.filter((item) => !item.archived && item.folderId === activeFolder.id);
                return <>
                  <div className="folder-view-head">
                    <button className="folder-back" onClick={() => setOpenFolderId(null)}><ArrowRight /><span>Back</span></button>
                    <button title="Edit folder" onClick={() => setFolderDialog({ mode: "rename", ...activeFolder })}><MoreHorizontal /></button>
                  </div>
                  <div className="folder-hero">
                    <span style={{ background: `${activeFolder.color}1f`, color: activeFolder.color }}><Icon /></span>
                    <div><b>{activeFolder.name}</b><small>{folderChats.length} conversations</small></div>
                  </div>
                  <button className="folder-new-chat" onClick={freshInFolder}><Plus />New chat in this folder</button>
                  <div className="history folder-history">
                    {renderChatRows(folderChats)}
                    {!folderChats.length && <div className="folder-empty"><MessageSquare /><b>No conversations yet</b><span>Move a chat here or start a new one.</span></div>}
                  </div>
                </>;
              })()}
            </div>
          </div>
        </div>
        <button className="profile-button" onClick={openSettings}>
          <span className="avatar">
            <CircleUserRound />
          </span>
          <span>
            <b>{config.branding.workspaceName}</b>
            <small>Private · Local-first</small>
          </span>
          <Settings />
        </button>
      </aside>
      <main>
        <header className="topbar">
          <div className="topbar-start">
            {!sidebar && (
              <button
                className="icon-button"
                aria-label="Open sidebar"
                onClick={() => setSidebar(true)}
              >
                <Menu />
              </button>
            )}
            <div className="model-wrap">
              <button
                className="model-picker"
                onClick={() => setModelOpen(!modelOpen)}
              >
                <span>
                  <b>{activeProvider?.name || "No provider"}</b>
                  <small>{config.activeModel || "Choose a model"}</small>
                </span>
                <ChevronDown />
              </button>
              {modelOpen && (
                <div className="model-menu">
                  {activeProvider?.models.map((model) => (
                    <button
                      key={model}
                      onClick={() => {
                        const next = { ...config, activeModel: model };
                        setConfig(next);
                        saveConfig(next);
                        setModelOpen(false);
                      }}
                    >
                      <span>{model}</span>
                      {config.activeModel === model && <Check />}
                    </button>
                  ))}
                  {!activeProvider?.models.length && (
                    <div className="empty-menu">No models connected</div>
                  )}
                  <button onClick={openSettings}>
                    <Settings />
                    <span>Manage models</span>
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="chat-actions">
            <span className="tooltip">
              <button className="icon-button" disabled>
                <Clock3 />
              </button>
              <span>Temporary chat · Coming soon</span>
            </span>
            <button className={`browser-toggle ${browserOpen ? "active" : ""}`} onClick={() => {
              setArtifact(null);
              if (browserOpen) {
                setBrowserOpen(false);
                setBrowserMaximized(false);
              } else {
                const available = window.innerWidth - (sidebar ? 272 : 0);
                if (available < 860) setBrowserMaximized(true);
                else setBrowserWidth((width) => Math.min(width, available - 430));
                setBrowserOpen(true);
              }
            }}>
              <PanelRight />
              Browse
            </button>
            <button className="share" onClick={share}>
              <Globe2 />
              Share
            </button>
          </div>
        </header>
        <div className="conversation">
          {chat.messages.length === 0 ? (
            <div className="welcome">
              <div className="welcome-mark">
                <BrandMark config={config} />
              </div>
              <span className="eyebrow">PRIVATE AI WORKSPACE</span>
              <h1>How can I help?</h1>
              <p>
                Explore ideas, work with files, and talk to the models you
                trust.
              </p>
              <div className="suggestions">
                <button
                  onClick={() => setText("Help me plan a project from scratch")}
                >
                  <Sparkles />
                  <span>
                    <b>Plan a project</b>
                    <small>Turn an idea into clear steps</small>
                  </span>
                  <ArrowRight />
                </button>
                <button
                  onClick={() => setText("Explain this concept simply: ")}
                >
                  <MessageSquare />
                  <span>
                    <b>Explain something</b>
                    <small>Make a complex topic simple</small>
                  </span>
                  <ArrowRight />
                </button>
                <button onClick={() => fileRef.current?.click()}>
                  <ImageIcon />
                  <span>
                    <b>Analyze an image</b>
                    <small>Upload and ask questions</small>
                  </span>
                  <ArrowRight />
                </button>
                <button
                  onClick={() =>
                    setText("Write a clean TypeScript function that ")
                  }
                >
                  <Code2 />
                  <span>
                    <b>Write some code</b>
                    <small>Build, debug, or improve</small>
                  </span>
                  <ArrowRight />
                </button>
              </div>
            </div>
          ) : (
            <div className="message-list">
              {chat.messages.map((message, index) => (
                <article key={index} className={message.role}>
                  <div className="speaker">
                    {message.role === "assistant" ? (
                      <BrandMark config={config} />
                    ) : (
                      <CircleUserRound />
                    )}
                  </div>
                  <div className="message-body">
                    {message.quote && (
                      <div className="message-quote" dir="auto"><Reply />{message.quote}</div>
                    )}
                    {message.attachments?.length ? (
                      <div className="attachments">
                        {message.attachments.map((attachment, itemIndex) =>
                          attachment.type.startsWith("image/") ? (
                            <img key={itemIndex} src={attachment.url} />
                          ) : (
                            <div className="file" key={itemIndex}>
                              <FileText />
                              <span>{attachment.name}</span>
                            </div>
                          ),
                        )}
                      </div>
                    ) : null}
                    <div className="content">
                      {message.content ? renderMessageContent(message) : (
                        <span className="typing">
                          <i />
                          <i />
                          <i />
                        </span>
                      )}
                    </div>
                    {message.role === "assistant" && message.content && (
                      <div className="message-actions">
                        <button onClick={() => copy(message.content)}>
                          <Copy />
                          Copy
                        </button>
                        <button onClick={() => openArtifact("Assistant response", "text", message.content)}>
                          <Maximize2 />
                          Open
                        </button>
                        <button
                          onClick={() =>
                            setChats((items) =>
                              items.map((item) =>
                                item.id === active
                                  ? {
                                      ...item,
                                      messages: item.messages.map((value, i) =>
                                        i === index
                                          ? { ...value, liked: !value.liked }
                                          : value,
                                      ),
                                    }
                                  : item,
                              ),
                            )
                          }
                          className={message.liked ? "selected" : ""}
                        >
                          <Check />
                          Helpful
                        </button>
                        <button onClick={() => archiveChat(active)}>
                          <Archive />
                          Archive
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>
        <div className="composer-zone">
          {!config.activeModel && (
            <button
              className="model-required"
              onClick={() => {
                setSettingsTab("models");
                openSettings();
              }}
            >
              <Bot />
              <span>
                <b>Connect a model to start chatting</b>
                <small>Open Models & providers in Settings</small>
              </span>
              <ArrowRight />
            </button>
          )}
          {replyQuote && (
            <div className="reply-preview" dir="auto">
              <Reply />
              <div><b>Replying to selection</b><span>{replyQuote}</span></div>
              <button aria-label="Cancel reply" onClick={() => setReplyQuote("")}><X /></button>
            </div>
          )}
          {files.length > 0 && (
            <div className="file-preview">
              {files.map((file, index) => (
                <div key={index}>
                  {file.type.startsWith("image/") ? (
                    <img src={file.url} />
                  ) : (
                    <FileText />
                  )}
                  <span>{file.name}</span>
                  <button
                    onClick={() =>
                      setFiles((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                  >
                    <X />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className={`composer ${!config.activeModel ? "locked" : ""}`}>
            <textarea
              disabled={!config.activeModel}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={key}
              placeholder={
                config.activeModel
                  ? `Message ${config.branding.appName}…`
                  : "Choose a model before sending a message"
              }
              rows={1}
            />
            <div className="composer-tools">
              <div>
                <button
                  disabled={!config.activeModel}
                  title="Attach file"
                  onClick={() => fileRef.current?.click()}
                >
                  <Paperclip />
                </button>
                <button
                  disabled={!config.activeModel}
                  title="Attach image"
                  onClick={() => fileRef.current?.click()}
                >
                  <ImageIcon />
                </button>
              </div>
              <div>
                <button
                  disabled={!config.activeModel}
                  className={listening ? "listening" : ""}
                  title="Voice input"
                  onClick={toggleVoice}
                >
                  <Mic />
                </button>
                <button
                  className={`send ${busy ? "stop" : ""}`}
                  disabled={!busy && (!config.activeModel || (!text.trim() && !files.length))}
                  onClick={busy ? stopResponse : send}
                  title={busy ? "Stop response" : "Send message"}
                >
                  {busy ? <Square /> : <ArrowUp />}
                </button>
              </div>
            </div>
            <input
              ref={fileRef}
              hidden
              type="file"
              multiple
              accept="image/*,.pdf,.txt,.md,.json,.csv"
              onChange={upload}
            />
          </div>
          <p>
            {config.branding.appName} can make mistakes. Verify important
            information.
          </p>
        </div>
      </main>

      {settingsOpen && (
        <div
          className="settings-backdrop"
          onMouseDown={() => setSettingsOpen(false)}
        >
          <div
            className="settings-window"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <aside className="settings-sidebar">
              <div className="settings-brand">
                <BrandMark config={draftConfig} />
                <span>
                  <b>{draftConfig.branding.appName}</b>
                  <small>Settings</small>
                </span>
              </div>
              <nav>
                {(
                  [
                    ["general", SlidersHorizontal, "General"],
                    ["models", Bot, "Models"],
                    ["data", Database, "Data & memory"],
                    ["updates", Download, "Updates"],
                    ["about", Info, "About"],
                  ] as const
                ).map(([id, Icon, label]) => (
                  <button
                    key={id}
                    className={settingsTab === id ? "active" : ""}
                    onClick={() => setSettingsTab(id)}
                  >
                    <Icon />
                    <span>{label}</span>
                    {id === "updates" && updateState === "available" && <i />}
                  </button>
                ))}
              </nav>
              <div className="settings-sidebar-actions">
                <button onClick={() => configFileRef.current?.click()}>
                  <Upload />
                  Import config
                </button>
                <button onClick={exportConfig}>
                  <Download />
                  Export config
                </button>
                <input
                  hidden
                  ref={configFileRef}
                  type="file"
                  accept="application/json,.json"
                  onChange={importConfig}
                />
              </div>
            </aside>
            <section className="settings-panel">
              <header>
                <div>
                  <h2>{settingMeta[settingsTab][0]}</h2>
                  <p>{settingMeta[settingsTab][1]}</p>
                </div>
                <button
                  className="icon-button"
                  onClick={() => setSettingsOpen(false)}
                >
                  <X />
                </button>
              </header>
              <div className="settings-scroll">
                {settingsTab === "general" && (
                  <>
                    <section className="settings-section compact-section">
                      <div className="setting-lead">
                        <div className="section-copy">
                          <h3>Appearance</h3>
                          <p>Follow your device or keep a fixed theme.</p>
                        </div>
                        <ThemeSelector
                          value={draftConfig.theme}
                          onChange={(theme) =>
                            setDraftConfig((current) => ({ ...current, theme }))
                          }
                        />
                      </div>
                    </section>
                    <section className="settings-section">
                      <div className="section-copy">
                        <h3>Workspace identity</h3>
                        <p>
                          Customize Nova for personal use or your organization.
                        </p>
                      </div>
                      <div className="identity-row">
                        <BrandMark
                          config={draftConfig}
                          className="identity-preview"
                        />
                        <div>
                          <b>Workspace logo</b>
                          <small>
                            Transparent PNG, SVG or WebP · up to 2 MB
                          </small>
                          <div>
                            <button
                              className="secondary"
                              onClick={() => logoFileRef.current?.click()}
                            >
                              Choose image
                            </button>
                            {draftConfig.branding.logoDataUrl && (
                              <button
                                className="quiet-button"
                                onClick={() =>
                                  setDraftConfig((current) => ({
                                    ...current,
                                    branding: {
                                      ...current.branding,
                                      logoDataUrl: "",
                                    },
                                  }))
                                }
                              >
                                Use default
                              </button>
                            )}
                          </div>
                        </div>
                        <input
                          hidden
                          ref={logoFileRef}
                          type="file"
                          accept="image/png,image/svg+xml,image/webp"
                          onChange={uploadLogo}
                        />
                      </div>
                      <div className="field-grid">
                        <label>
                          Application name
                          <input
                            value={draftConfig.branding.appName}
                            onChange={(e) =>
                              setDraftConfig((current) => ({
                                ...current,
                                branding: {
                                  ...current.branding,
                                  appName: e.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                        <label>
                          Workspace name
                          <input
                            value={draftConfig.branding.workspaceName}
                            onChange={(e) =>
                              setDraftConfig((current) => ({
                                ...current,
                                branding: {
                                  ...current.branding,
                                  workspaceName: e.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                      </div>
                      <label>
                        Accent color
                        <div className="color-input">
                          <input
                            type="color"
                            value={draftConfig.branding.accent}
                            onChange={(e) =>
                              setDraftConfig((current) => ({
                                ...current,
                                branding: {
                                  ...current.branding,
                                  accent: e.target.value,
                                },
                              }))
                            }
                          />
                          <code>{draftConfig.branding.accent}</code>
                        </div>
                      </label>
                    </section>
                    <section className="settings-section">
                      <div className="section-copy">
                        <h3>Response style</h3>
                        <p>
                          Choose how creative or predictable model responses
                          should be.
                        </p>
                      </div>
                      <label className="range-control">
                        <span>
                          Creativity <b>{draftConfig.temperature.toFixed(1)}</b>
                        </span>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.1"
                          value={draftConfig.temperature}
                          onChange={(e) =>
                            setDraftConfig((current) => ({
                              ...current,
                              temperature: Number(e.target.value),
                            }))
                          }
                        />
                        <span className="range-labels">
                          <small>Precise</small>
                          <small>Creative</small>
                        </span>
                      </label>
                    </section>
                  </>
                )}
                {settingsTab === "models" && (
                  <div className="models-settings">
                    <div className="provider-tabs">
                      {draftConfig.providers.map((provider) => (
                        <button
                          key={provider.id}
                          className={
                            provider.id === draftConfig.activeProviderId
                              ? "active"
                              : ""
                          }
                          onClick={() =>
                            setDraftConfig((current) => ({
                              ...current,
                              activeProviderId: provider.id,
                              activeModel: provider.models[0] || "",
                            }))
                          }
                        >
                          <i />
                          {provider.name}
                          <small>{provider.models.length}</small>
                        </button>
                      ))}
                      <button className="add-provider" onClick={addProvider}>
                        <Plus />
                        Add provider
                      </button>
                    </div>
                    {activeDraftProvider ? (
                      <>
                        <section className="settings-section">
                          <div className="section-heading">
                            <div className="section-copy">
                              <h3>Connection</h3>
                              <p>
                                Works with OpenAI-compatible APIs, including
                                local servers.
                              </p>
                            </div>
                            <button
                              className="danger-button"
                              onClick={() =>
                                removeProvider(activeDraftProvider.id)
                              }
                            >
                              <Trash2 />
                              Remove
                            </button>
                          </div>
                          <div className="field-grid">
                            <label>
                              Provider name
                              <input
                                value={activeDraftProvider.name}
                                onChange={(e) =>
                                  updateDraftProvider({ name: e.target.value })
                                }
                              />
                            </label>
                            <label>
                              Base URL
                              <input
                                value={activeDraftProvider.baseUrl}
                                placeholder="http://localhost:11434/v1"
                                onChange={(e) =>
                                  updateDraftProvider({
                                    baseUrl: e.target.value,
                                  })
                                }
                              />
                            </label>
                          </div>
                          <label>
                            API key{" "}
                            <small className="optional">
                              Optional for local providers
                            </small>
                            <input
                              type="password"
                              value={activeDraftProvider.apiKey}
                              placeholder="sk-…"
                              onChange={(e) =>
                                updateDraftProvider({ apiKey: e.target.value })
                              }
                            />
                          </label>
                          <button
                            className="primary-button"
                            disabled={
                              syncingId === activeDraftProvider.id ||
                              !activeDraftProvider.baseUrl
                            }
                            onClick={refreshModels}
                          >
                            <RefreshCw
                              className={syncingId ? "spinning" : ""}
                            />
                            {syncingId
                              ? "Connecting…"
                              : "Connect & discover models"}
                          </button>
                        </section>
                        <section className="settings-section">
                          <div className="section-copy">
                            <h3>Available models</h3>
                            <p>
                              Models are listed only after your provider returns
                              them successfully.
                            </p>
                          </div>
                          <div className="model-list">
                            {activeDraftProvider.models.map((model) => {
                              const latency =
                                verifiedModels[
                                  `${activeDraftProvider.id}:${model}`
                                ];
                              return (
                                <div
                                  key={model}
                                  className={
                                    draftConfig.activeModel === model
                                      ? "active"
                                      : ""
                                  }
                                >
                                  <button
                                    className="model-name"
                                    onClick={() =>
                                      setDraftConfig((current) => ({
                                        ...current,
                                        activeModel: model,
                                      }))
                                    }
                                  >
                                    <i className={latency ? "verified" : ""} />
                                    <span>
                                      <b>{model}</b>
                                      <small>
                                        {draftConfig.activeModel === model
                                          ? "Active model"
                                          : "Available"}
                                      </small>
                                    </span>
                                  </button>
                                  <div>
                                    {latency ? (
                                      <span className="verified-label">
                                        <ShieldCheck />
                                        Verified · {latency} ms
                                      </span>
                                    ) : (
                                      <button
                                        className="test-button"
                                        disabled={testingModel === model}
                                        onClick={() => verifyModel(model)}
                                      >
                                        {testingModel === model
                                          ? "Testing…"
                                          : "Test"}
                                      </button>
                                    )}
                                    <button
                                      className="icon-button subtle"
                                      onClick={() =>
                                        updateDraftProvider({
                                          models:
                                            activeDraftProvider.models.filter(
                                              (value) => value !== model,
                                            ),
                                        })
                                      }
                                    >
                                      <X />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                            {!activeDraftProvider.models.length && (
                              <div className="empty-models">
                                <Bot />
                                <b>No models yet</b>
                                <span>
                                  Connect to the provider to discover real
                                  models.
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="manual-model">
                            <input
                              value={manualModel}
                              placeholder="Exact model ID"
                              onChange={(e) => setManualModel(e.target.value)}
                            />
                            <button
                              disabled={
                                !manualModel.trim() ||
                                testingModel === manualModel.trim()
                              }
                              onClick={addManualModel}
                            >
                              <Plus />
                              {testingModel && testingModel === manualModel.trim()
                                ? "Testing…"
                                : "Test & add"}
                            </button>
                          </div>
                        </section>
                        <section className="settings-section local-import">
                          <div className="section-copy">
                            <h3>Import a local model file</h3>
                            <p>
                              Choose a GGUF file. Nova stores a private copy and
                              registers it with Ollama, so no endpoint or model
                              ID is required.
                            </p>
                          </div>
                          <button
                            className="local-drop"
                            disabled={importingLocalModel}
                            onClick={importLocalModel}
                          >
                            <HardDriveUpload />
                            <span>
                              <b>
                                {importingLocalModel
                                  ? "Importing model…"
                                  : "Choose a GGUF file"}
                              </b>
                              <small>
                                Desktop only · Ollama must be installed
                              </small>
                            </span>
                          </button>
                        </section>
                      </>
                    ) : (
                      <div className="empty-page">
                        <Bot />
                        <h3>Add your first provider</h3>
                        <p>Connect a local or cloud AI service to begin.</p>
                        <button
                          className="primary-button"
                          onClick={addProvider}
                        >
                          <Plus />
                          Add provider
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {settingsTab === "data" && (
                  <>
                    <section className="settings-section">
                      <div className="toggle-row">
                        <div className="section-copy">
                          <h3>Project database</h3>
                          <p>
                            Optionally connect storage for long-term memory and
                            organization data.
                          </p>
                        </div>
                        <button
                          aria-label="Toggle database"
                          className={`switch ${draftConfig.database.enabled ? "on" : ""}`}
                          onClick={() =>
                            setDraftConfig((current) => ({
                              ...current,
                              database: {
                                ...current.database,
                                enabled: !current.database.enabled,
                                kind: current.database.enabled
                                  ? "none"
                                  : "postgresql",
                              },
                            }))
                          }
                        >
                          <i />
                        </button>
                      </div>
                      {draftConfig.database.enabled && (
                        <div className="revealed-fields">
                          <label>
                            Database type
                            <select
                              value={draftConfig.database.kind}
                              onChange={(e) =>
                                setDraftConfig((current) => ({
                                  ...current,
                                  database: {
                                    ...current.database,
                                    kind: e.target
                                      .value as Config["database"]["kind"],
                                  },
                                }))
                              }
                            >
                              <option value="postgresql">PostgreSQL</option>
                              <option value="mysql">MySQL</option>
                              <option value="sqlite">SQLite</option>
                              <option value="http">HTTP API</option>
                            </select>
                          </label>
                          <label>
                            Connection URL
                            <input
                              type="password"
                              value={draftConfig.database.url}
                              placeholder="postgresql://user:password@host/database"
                              onChange={(e) =>
                                setDraftConfig((current) => ({
                                  ...current,
                                  database: {
                                    ...current.database,
                                    url: e.target.value,
                                  },
                                }))
                              }
                            />
                          </label>
                          <div className="toggle-row nested">
                            <div>
                              <b>Use for AI memory</b>
                              <p>
                                Allow selected models to retrieve saved context.
                              </p>
                            </div>
                            <button
                              className={`switch ${draftConfig.database.useForMemory ? "on" : ""}`}
                              onClick={() =>
                                setDraftConfig((current) => ({
                                  ...current,
                                  database: {
                                    ...current.database,
                                    useForMemory:
                                      !current.database.useForMemory,
                                  },
                                }))
                              }
                            >
                              <i />
                            </button>
                          </div>
                        </div>
                      )}
                    </section>
                    <div className="security-note">
                      <ShieldCheck />
                      <div>
                        <b>Your credentials stay on this device</b>
                        <p>
                          Secrets are excluded from exported configuration
                          files.
                        </p>
                      </div>
                    </div>
                  </>
                )}
                {settingsTab === "updates" && (
                  <div className="center-panel update-center">
                    <div className="status-icon">
                      <RefreshCw
                        className={updateState === "checking" ? "spinning" : ""}
                      />
                    </div>
                    <span className="version-chip">
                      Installed · {APP_VERSION}
                    </span>
                    <h3>
                      {updateDownloaded
                        ? "Update ready to install"
                        : updateState === "available"
                          ? `Nova ${updateInfo?.version} is available`
                          : updateState === "latest"
                            ? "Nova is up to date"
                            : updateState === "error"
                              ? "Update check failed"
                              : "Updates, without leaving Nova"}
                    </h3>
                    <p>
                      {updateDownloaded
                        ? "The verified update is downloaded. Restart Nova to finish installing it."
                        : updateState === "available"
                          ? isDesktopApp()
                            ? "Download the verified update here. Nova will show progress and install it after you restart."
                            : "A newer desktop version is available."
                          : updateState === "error"
                            ? "Nova could not reach the update service."
                            : "Nova securely checks GitHub for signed releases."}
                    </p>
                    {updateInfo?.notes?.length &&
                    updateState === "available" ? (
                      <div className="release-notes">
                        {updateInfo.notes.map((note) => (
                          <span key={note}>
                            <Check />
                            {note}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {downloadProgress && (
                      <div className="download-progress">
                        <div>
                          <span>
                            {updateDownloaded
                              ? "Download complete"
                              : "Downloading update…"}
                          </span>
                          <b>
                            {downloadProgress.percent
                              ? `${downloadProgress.percent}%`
                              : "…"}
                          </b>
                        </div>
                        <progress max="100" value={downloadProgress.percent} />
                        {downloadProgress.total > 0 && (
                          <small>
                            {(downloadProgress.downloaded / 1048576).toFixed(1)}{" "}
                            MB of{" "}
                            {(downloadProgress.total / 1048576).toFixed(1)} MB
                          </small>
                        )}
                      </div>
                    )}
                    {updateError && (
                      <div className="update-error">{updateError}</div>
                    )}
                    {updateDownloaded ? (
                      <button
                        className="primary-button restart-button"
                        onClick={restartAndInstall}
                      >
                        <RefreshCw />
                        Restart and install
                      </button>
                    ) : updateState === "available" && isDesktopApp() ? (
                      <button
                        className="primary-button"
                        disabled={!!downloadProgress}
                        onClick={downloadUpdate}
                      >
                        <Download />
                        Download update
                      </button>
                    ) : (
                      <button
                        className="primary-button"
                        disabled={updateState === "checking"}
                        onClick={checkUpdates}
                      >
                        <RefreshCw
                          className={
                            updateState === "checking" ? "spinning" : ""
                          }
                        />
                        {updateState === "checking"
                          ? "Checking…"
                          : "Check for updates"}
                      </button>
                    )}
                    {updateState === "available" && !isDesktopApp() && (
                      <a
                        className="download-link"
                        href={updateInfo?.installerUrl}
                        target="_blank"
                      >
                        <Download />
                        Download version {updateInfo?.version}
                      </a>
                    )}
                    <small>
                      {isDesktopApp()
                        ? "Every update is verified before installation."
                        : "Web versions update automatically when refreshed."}
                    </small>
                  </div>
                )}
                {settingsTab === "about" && (
                  <div className="center-panel about">
                    <BrandMark config={draftConfig} className="about-mark" />
                    <h3>{draftConfig.branding.appName}</h3>
                    <p>
                      Private, configurable AI for individuals and
                      organizations.
                    </p>
                    <dl>
                      <div>
                        <dt>Version</dt>
                        <dd>{APP_VERSION}</dd>
                      </div>
                      <div>
                        <dt>Configuration</dt>
                        <dd>Managed JSON supported</dd>
                      </div>
                      <div>
                        <dt>License</dt>
                        <dd>Open source · MIT</dd>
                      </div>
                    </dl>
                  </div>
                )}
              </div>
              <footer>
                <span>Changes are saved locally on this device.</span>
                <div>
                  <button
                    className="secondary"
                    onClick={() => setSettingsOpen(false)}
                  >
                    Cancel
                  </button>
                  <button className="save-button" onClick={saveSettings}>
                    Save changes
                  </button>
                </div>
              </footer>
            </section>
          </div>
        </div>
      )}
      {selectionToolbar && (
        <div className="selection-toolbar" style={{ left: selectionToolbar.x, top: selectionToolbar.y }}>
          <button onMouseDown={(event) => event.preventDefault()} onClick={() => { copy(selectionToolbar.text); setSelectionToolbar(null); }}><Copy />Copy</button>
          <button onMouseDown={(event) => event.preventDefault()} onClick={() => replyToSelection(selectionToolbar.text)}><Reply />Reply</button>
        </div>
      )}
      {artifact && (
        <div className="artifact-backdrop" onMouseDown={() => setArtifact(null)}>
          <aside className="artifact-panel" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span className="artifact-icon"><Code2 /></span><span><b>{artifact.title}</b><small>{artifact.language || "document"}</small></span></div>
              <div className="artifact-actions">
                <button onClick={() => copy(artifactDraft)}><Copy />Copy</button>
                <button onClick={downloadArtifact}><Download />Save</button>
                <button className="artifact-close" aria-label="Close artifact" onClick={() => setArtifact(null)}><X /></button>
              </div>
            </header>
            <nav>
              <button className={artifactTab === "edit" ? "active" : ""} onClick={() => setArtifactTab("edit")}><Pencil />Edit</button>
              <button className={artifactTab === "preview" ? "active" : ""} onClick={() => setArtifactTab("preview")}><Globe2 />Preview</button>
            </nav>
            <div className="artifact-workspace">
              {artifactTab === "edit" ? (
                <textarea spellCheck={artifact.language === "text"} value={artifactDraft} onChange={(event) => setArtifactDraft(event.target.value)} />
              ) : artifact.language.toLowerCase() === "html" ? (
                <div className="browser-preview">
                  <div><i /><i /><i /><span><Globe2 />nova://preview/artifact</span></div>
                  <iframe title="Artifact preview" sandbox="" srcDoc={artifactDraft} />
                </div>
              ) : (
                <div className="document-preview" dir="auto">{artifactDraft}</div>
              )}
            </div>
          </aside>
        </div>
      )}
      <aside
        className={`nova-browser ${browserOpen ? "" : "closed"} ${browserMaximized ? "maximized" : ""}`}
        style={{ "--browser-width": `${browserWidth}px` } as CSSProperties}
        aria-label="Nova browser"
        aria-hidden={!browserOpen}
      >
          <div className="browser-resizer" onPointerDown={startBrowserResize}><span /></div>
          <header>
            <div className="browser-title">
              <span><Globe2 /></span>
              <div><b>Nova Browse</b><small>Private in-app viewer</small></div>
            </div>
            <div className="browser-header-actions">
              <button disabled={!activeBrowserTab?.url} onClick={openSystemBrowser} title="Open in your default browser"><ExternalLink /></button>
              <button onClick={() => setBrowserMaximized((value) => !value)} title={browserMaximized ? "Restore split view" : "Full screen"}>{browserMaximized ? <Minimize2 /> : <Maximize2 />}</button>
              <button onClick={() => { setBrowserOpen(false); setBrowserMaximized(false); }} title="Close"><X /></button>
            </div>
          </header>
          <div className="browser-tabs">
            <div>
              {browserTabs.map((tab) => (
                <button className={tab.id === activeBrowserTabId ? "active" : ""} key={tab.id} onClick={() => setActiveBrowserTabId(tab.id)} title={tab.title}>
                  <Globe2 /><span>{tab.title}</span><i onClick={(event) => { event.stopPropagation(); closeBrowserTab(tab.id); }}><X /></i>
                </button>
              ))}
            </div>
            <button className="new-browser-tab" onClick={addBrowserTab} aria-label="New browser tab"><Plus /></button>
          </div>
          <form className="browser-address" onSubmit={(event) => { event.preventDefault(); navigateBrowser(activeBrowserTab?.input || ""); }}>
            <button type="button" disabled={!activeBrowserTab || activeBrowserTab.historyIndex <= 0} onClick={() => moveBrowserHistory(-1)} aria-label="Back"><ArrowRight className="browser-back" /></button>
            <button type="button" disabled={!activeBrowserTab || activeBrowserTab.historyIndex >= activeBrowserTab.history.length - 1} onClick={() => moveBrowserHistory(1)} aria-label="Forward"><ArrowRight /></button>
            <button type="button" disabled={!activeBrowserTab?.url} onClick={() => setBrowserFrameKey((key) => key + 1)} aria-label="Reload"><RefreshCw /></button>
            <Globe2 />
            <input
              aria-label="Search or enter address"
              value={activeBrowserTab?.input || ""}
              onChange={(event) => updateBrowserInput(event.target.value)}
              placeholder="Search the web or enter a URL"
            />
            {activeBrowserTab?.input && <button type="button" onClick={() => updateBrowserInput("")} aria-label="Clear"><X /></button>}
            <button type="submit" className="browser-go" aria-label="Go"><ArrowRight /></button>
          </form>
          <div className="browser-surface" ref={browserSurfaceRef}>
            {activeBrowserTab?.url ? (
              <>
                {!isDesktopApp() && <iframe key={`${activeBrowserTab.id}-${activeBrowserTab.url}-${browserFrameKey}`} title="Nova browser" src={activeBrowserTab.url} sandbox="allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-scripts allow-same-origin" />}
                <div className="browser-fallback">
                  <span>{isDesktopApp() ? "Native secure webview" : "Protected sites may require the system browser."}</span>
                  <button onClick={openSystemBrowser}><ExternalLink />Open externally</button>
                </div>
              </>
            ) : (
              <div className="browser-empty">
                <span><Globe2 /></span>
                <h3>Browse without leaving your chat</h3>
                <p>Search the web or open links from Nova responses here.</p>
                <div>
                  <button onClick={() => navigateBrowser("AI news today")}>AI news</button>
                  <button onClick={() => navigateBrowser("developer documentation")}>Developer docs</button>
                  <button onClick={() => navigateBrowser("local AI models")}>Local AI</button>
                </div>
              </div>
            )}
          </div>
      </aside>
      {chatMenu && (
        <div className="context-layer" onMouseDown={() => setChatMenu(null)}>
          <div
            className="context-menu"
            style={{ left: Math.min(chatMenu.x, window.innerWidth - 238), top: Math.min(chatMenu.y, window.innerHeight - 360) }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button onClick={() => { requestRenameChat(chatMenu.chatId); setChatMenu(null); }}><Pencil />Rename</button>
            <button onClick={() => { archiveChat(chatMenu.chatId); setChatMenu(null); }}><Archive />Archive</button>
            <div className="context-separator" />
            <small>Move to folder</small>
            {folders.map((folder) => {
              const Icon = folderIcons[folder.icon];
              return <button key={folder.id} onClick={() => moveChat(chatMenu.chatId, folder.id)}><Icon style={{ color: folder.color }} />{folder.name}</button>;
            })}
            {chats.find((item) => item.id === chatMenu.chatId)?.folderId && (
              <button onClick={() => moveChat(chatMenu.chatId)}><X />Remove from folder</button>
            )}
            {!folders.length && <em>Create a folder first</em>}
            <div className="context-separator" />
            <button className="danger" onClick={() => { requestDeleteChat(chatMenu.chatId); setChatMenu(null); }}><Trash2 />Delete</button>
          </div>
        </div>
      )}
      {folderDialog && (
        <div className="confirm-backdrop" onMouseDown={() => setFolderDialog(null)}>
          <div className="confirm-dialog folder-dialog" onMouseDown={(event) => event.stopPropagation()}>
            {(() => { const PreviewIcon = folderIcons[folderDialog.icon]; return <div className="confirm-icon" style={{ color: folderDialog.color, background: `${folderDialog.color}1f` }}><PreviewIcon /></div>; })()}
            <h3>{folderDialog.mode === "create" ? "Create folder" : "Edit folder"}</h3>
            <p>Organize related conversations with a name, color, and icon.</p>
            <input
              autoFocus
              value={folderDialog.name}
              placeholder="Folder name"
              onChange={(event) => setFolderDialog({ ...folderDialog, name: event.target.value })}
              onKeyDown={(event) => event.key === "Enter" && saveFolder()}
            />
            {(() => { const PreviewIcon = folderIcons[folderDialog.icon]; return <div className="folder-live-preview"><span style={{ color: folderDialog.color, background: `${folderDialog.color}1f` }}><PreviewIcon /></span><div><b>{folderDialog.name.trim() || "Folder name"}</b><small>Live preview</small></div><ChevronDown /></div>; })()}
            <div className="folder-choices">
              <span>Icon</span>
              <div>{(Object.keys(folderIcons) as ChatFolder["icon"][]).map((icon) => {
                const Icon = folderIcons[icon];
                return <button title={icon} aria-label={`${icon} icon`} className={folderDialog.icon === icon ? "selected" : ""} key={icon} onClick={() => setFolderDialog({ ...folderDialog, icon })}><Icon /></button>;
              })}</div>
              <span>Color</span>
              <div>{folderColors.map((color) => <button aria-label={color} className={folderDialog.color === color ? "selected color" : "color"} style={{ background: color }} key={color} onClick={() => setFolderDialog({ ...folderDialog, color })} />)}</div>
            </div>
            <div>
              {folderDialog.mode === "rename" && <button className="confirm-delete" onClick={() => { deleteFolder(folderDialog.id!); setFolderDialog(null); }}>Delete folder</button>}
              <button className="save-button" disabled={!folderDialog.name.trim()} onClick={saveFolder}>Save folder</button>
            </div>
          </div>
        </div>
      )}
      {chatDialog && (
        <div
          className="confirm-backdrop"
          onMouseDown={() => setChatDialog(null)}
        >
          <div
            className="confirm-dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={`confirm-icon ${chatDialog.mode}`}>
              {chatDialog.mode === "delete" ? <Trash2 /> : <Pencil />}
            </div>
            <h3>
              {chatDialog.mode === "delete"
                ? "Delete conversation?"
                : "Rename conversation"}
            </h3>
            <p>
              {chatDialog.mode === "delete"
                ? `“${chatDialog.value}” will be permanently removed from this device.`
                : "Choose a clear name so this conversation is easy to find later."}
            </p>
            {chatDialog.mode === "rename" && (
              <input
                autoFocus
                value={chatDialog.value}
                onChange={(event) =>
                  setChatDialog({ ...chatDialog, value: event.target.value })
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") confirmChatDialog();
                }}
              />
            )}
            <div>
              <button className="secondary" onClick={() => setChatDialog(null)}>
                Cancel
              </button>
              <button
                className={
                  chatDialog.mode === "delete"
                    ? "confirm-delete"
                    : "save-button"
                }
                disabled={
                  chatDialog.mode === "rename" && !chatDialog.value.trim()
                }
                onClick={confirmChatDialog}
              >
                {chatDialog.mode === "delete"
                  ? "Delete conversation"
                  : "Save name"}
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className={`toast ${toastIsError ? "error" : "success"}`}>
          {toastIsError ? <X /> : <Check />}
          {toast}
        </div>
      )}
    </div>
  );
}
