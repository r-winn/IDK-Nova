import {
  ChangeEvent,
  CSSProperties,
  Fragment,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Archive,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  ArrowRight,
  ArrowUp,
  Bot,
  BookOpen,
  BriefcaseBusiness,
  Check,
  CheckCheck,
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
  Mail,
  Menu,
  MessageSquare,
  Mic,
  Minimize2,
  MoreHorizontal,
  PanelLeftClose,
  PanelsTopLeft,
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
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Channel, invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { AgentTool, AgentToolCall, discoverModels, runAgentCompletion, streamCompletion, testModel } from "./lib/ai";
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
  WorkProject,
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
const agentTools: AgentTool[] = [
  { type: "function", function: { name: "list_files", description: "List files and directories in the current Nova Work project.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "read_file", description: "Read a supported text or source file inside the current Work project.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } } },
  { type: "function", function: { name: "write_file", description: "Create or replace a text/source file inside the current Work project. Existing files are backed up automatically.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"], additionalProperties: false } } },
  { type: "function", function: { name: "web_search", description: "Open a web search in Nova Workspace Browser.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } } },
  { type: "function", function: { name: "open_url", description: "Open an HTTP or HTTPS URL in Nova Workspace Browser.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false } } },
];
const settingMeta = {
  general: ["General", "Personalize Nova and choose how it looks."],
  models: [
    "AI models",
    "Manage the models available to Nova.",
  ],
  data: ["Data & memory", "Control optional storage and long-term context."],
  updates: ["Software update", "Keep Nova secure and up to date."],
  about: ["About Nova", "Version, licensing and deployment details."],
} as const;
const agentStepLabel = (step: string) => ({
  thinking: "Planning the next step…",
  list_files: "Reviewing project files…",
  read_file: "Reading a project file…",
  write_file: "Creating or updating a project file…",
  web_search: "Preparing a web search…",
  open_url: "Preparing to open a website…",
} as Record<string, string>)[step] || `Working on ${step.replaceAll("_", " ")}…`;
type SettingsTab = keyof typeof settingMeta;
type ChatDialog = {
  mode: "rename" | "delete";
  id: number;
  value: string;
} | null;
type FolderDialog = { mode: "create" | "rename"; id?: string; name: string; color: string; icon: ChatFolder["icon"] } | null;
type WorkspaceEntry = { path: string; name: string; kind: "file" | "directory"; size: number; modified: number };
type WorkspaceScan = { entries: WorkspaceEntry[]; truncated: boolean };
type WorkspaceMatch = { path: string; line: number; preview: string };
type PortableWorkspace = { projectJson: string; chatsJson: string };
type ChatMenu = { chatId: number; x: number; y: number } | null;
type SelectionToolbar = { text: string; x: number; y: number } | null;
type AgentApproval = { title: string; detail: string; risk: "browser" | "file" } | null;
type BrowserTab = {
  id: string;
  kind: "home" | "browser" | "artifact" | "document" | "email" | "files" | "projectfiles" | "temporary" | "image";
  title: string;
  url: string;
  input: string;
  history: string[];
  historyIndex: number;
  language?: string;
  content?: string;
  artifactView?: "edit" | "preview";
  messages?: Message[];
  draft?: string;
  busy?: boolean;
  imageUrl?: string;
  imageZoom?: number;
  subject?: string;
  startedAt?: number;
  documentFont?: "sans" | "serif" | "mono";
  documentSize?: number;
  documentAlign?: "start" | "center" | "justify";
  projectId?: string;
  entries?: WorkspaceEntry[];
};
type NativeBrowserView = { webview: Webview; url: string; frameKey: number };
type DocumentArtifact = { kind: "email" | "document"; title: string; subject: string; body: string; before: string; after: string };

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
  const pattern = /```([\w+-]*)\r?\n([\s\S]*?)(?:```|$)/g;
  let cursor = 0;
  for (const match of content.matchAll(pattern)) {
    if (match.index! > cursor) parts.push({ type: "text", content: content.slice(cursor, match.index), language: "" });
    parts.push({ type: "code", content: match[2].replace(/\n$/, ""), language: match[1] || "code" });
    cursor = match.index! + match[0].length;
  }
  if (cursor < content.length) parts.push({ type: "text", content: content.slice(cursor), language: "" });
  return parts.length ? parts : [{ type: "text" as const, content, language: "" }];
};
const quotePreview = (value: string, limit = 240) => {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > limit ? `${compact.slice(0, limit).trimEnd()}…` : compact;
};
const formatDuration = (milliseconds: number) => milliseconds < 60_000
  ? `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`
  : `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1000)}s`;
const detectDocumentArtifact = (value: string): DocumentArtifact | null => {
  const separators = [...value.matchAll(/^---\s*$/gm)];
  const firstSeparator = separators[0];
  const secondSeparator = separators[1];
  const before = firstSeparator ? value.slice(0, firstSeparator.index).trim() : "";
  const bodyStart = firstSeparator ? (firstSeparator.index || 0) + firstSeparator[0].length : 0;
  const bodyEnd = secondSeparator?.index ?? value.length;
  const candidate = value.slice(bodyStart, bodyEnd).trim();
  const after = secondSeparator ? value.slice((secondSeparator.index || 0) + secondSeparator[0].length).trim() : "";
  const subjectMatch = candidate.match(/^(?:\*\*)?(?:موضوع|subject)\s*:\s*(?:\*\*)?(.+?)(?:\*\*)?\s*$/im);
  const emailRequested = /ایمیل|پست الکترونیک|email/i.test(`${before}\n${candidate.slice(0, 180)}`);
  const looksLikeEmail = Boolean(subjectMatch) || (emailRequested && candidate.length >= 80) || /(^|\n)(سلام|درود|dear|hello)[،,!\s]/i.test(candidate) && /(^|\n)(با تشکر|با احترام|ارادتمند|sincerely|regards|best)[،,!\s]/i.test(candidate);
  const firstHeadingText = candidate.match(/^#{1,3}\s+(.+)$/m)?.[1] || "";
  const documentSignal = `${before}\n${firstHeadingText}`;
  const looksLikeDocument = candidate.length >= 180 && /مقاله|گزارش|نامه|article|report|letter|proposal|طرح پیشنهادی|پیش.?نویس|چک.?لیست محتوا/i.test(documentSignal);
  if (!looksLikeEmail && !looksLikeDocument) return null;
  const subject = subjectMatch?.[1]?.replace(/\*\*/g, "").trim() || "";
  const body = subjectMatch ? candidate.replace(subjectMatch[0], "").trim() : candidate;
  const heading = candidate.match(/^#{1,3}\s+(?:\*\*)?(.+?)(?:\*\*)?\s*$/m)?.[1]?.replace(/\*\*/g, "").trim();
  return {
    kind: looksLikeEmail ? "email" : "document",
    title: looksLikeEmail ? (subject || "Email draft") : (heading || "Document draft"),
    subject,
    body,
    before,
    after,
  };
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
        messages: Array.isArray(item.messages) ? item.messages.map((message) => ({ ...message, generating: false })) : [],
      }));
    return valid.length ? valid : starterChats;
  });
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [responseElapsedMs, setResponseElapsedMs] = useState(0);
  const [workspaceClock, setWorkspaceClock] = useState(Date.now());
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
  const [workspaces, setWorkspaces] = useState<WorkProject[]>(() => loadValue<any[]>("idk-nova-workspaces", []).map((workspace) => ({
    ...workspace,
    agentAccess: workspace.agentAccess === "auto" ? "auto" : workspace.agentAccess === "safe" ? "safe" : "ask",
  })));
  const [workspacesOpen, setWorkspacesOpen] = useState(false);
  const [openWorkspaceId, setOpenWorkspaceId] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceDelete, setWorkspaceDelete] = useState<WorkProject | null>(null);
  const [agentAccessOpen, setAgentAccessOpen] = useState(false);
  const [agentAccessClosing, setAgentAccessClosing] = useState(false);
  const [agentApproval, setAgentApproval] = useState<AgentApproval>(null);
  const [agentStatus, setAgentStatus] = useState("");
  const [chatMenu, setChatMenu] = useState<ChatMenu>(null);
  const [selectionToolbar, setSelectionToolbar] = useState<SelectionToolbar>(null);
  const [replyQuote, setReplyQuote] = useState("");
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([{ id: "start", kind: "home", title: "Workspace", url: "", input: "", history: [], historyIndex: -1 }]);
  const [activeBrowserTabId, setActiveBrowserTabId] = useState("start");
  const [browserFrameKey, setBrowserFrameKey] = useState(0);
  const [browserWidth, setBrowserWidth] = useState(() => loadValue<number>("idk-nova-browser-width", 560));
  const [browserMaximized, setBrowserMaximized] = useState(false);
  const [browserRestoring, setBrowserRestoring] = useState(false);
  const [importingLocalModel, setImportingLocalModel] = useState(false);
  const [ollamaInstalled, setOllamaInstalled] = useState<boolean | null>(null);
  const [pendingGgufPath, setPendingGgufPath] = useState("");
  const [ollamaInstall, setOllamaInstall] = useState<{ phase: string; message: string; downloaded: number; total: number; error: string } | null>(null);
  const [listening, setListening] = useState(false);
  const [config, setConfig] = useState<Config>(loadConfig);
  const [draftConfig, setDraftConfig] = useState<Config>(config);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [syncingId, setSyncingId] = useState("");
  const [manualModel, setManualModel] = useState("");
  const [modelSetupView, setModelSetupView] = useState<"list" | "choose" | "api" | "local">("list");
  const [newProvider, setNewProvider] = useState<Provider>({ id: "", name: "", baseUrl: "", apiKey: "", models: [] });
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [testingModel, setTestingModel] = useState("");
  const [verifiedModels, setVerifiedModels] = useState<Record<string, number>>(
    {},
  );
  const [updateState, setUpdateState] = useState<
    "idle" | "checking" | "latest" | "available" | "error"
  >("idle");
  const [installedVersion, setInstalledVersion] = useState(APP_VERSION);
  const [updateInfo, setUpdateInfo] = useState<UpdateManifest | null>(null);
  const [nativeUpdate, setNativeUpdate] = useState<NativeUpdate | null>(null);
  const [downloadProgress, setDownloadProgress] =
    useState<DownloadProgress | null>(null);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null),
    endRef = useRef<HTMLDivElement>(null),
    conversationRef = useRef<HTMLDivElement>(null),
    stickToBottomRef = useRef(true),
    responseStartedRef = useRef(0),
    configExportRef = useRef(0),
    configFileRef = useRef<HTMLInputElement>(null),
    logoFileRef = useRef<HTMLInputElement>(null),
    browserSurfaceRef = useRef<HTMLDivElement>(null),
    nativeBrowserViewsRef = useRef<Map<string, NativeBrowserView>>(new Map()),
    startupChatReadyRef = useRef(false),
    abortRef = useRef<AbortController | null>(null);
  const approvalResolverRef = useRef<((approved: boolean) => void) | null>(null);
  const chat = chats.find((item) => item.id === active) || chats[0];
  const chatWorkspace = workspaces.find((workspace) => workspace.id === chat?.workspaceId);
  const activeProvider = getActiveProvider(config);
  const activeBrowserTab = browserTabs.find((tab) => tab.id === activeBrowserTabId) || browserTabs[0];
  const workspaceArtifacts = useMemo(() => chats.flatMap((sourceChat) => sourceChat.messages.flatMap((message, messageIndex) => {
    if (message.role !== "assistant") return [];
    return splitContent(message.content).flatMap((part, partIndex) => part.type === "code" ? [{
      id: `${sourceChat.id}-${messageIndex}-${partIndex}`,
      title: `${part.language || "code"}-${messageIndex + 1}-${partIndex + 1}.${({ javascript: "js", typescript: "ts", python: "py", html: "html", css: "css", json: "json" } as Record<string, string>)[part.language.toLowerCase()] || "txt"}`,
      language: part.language || "text",
      content: part.content,
      chatTitle: sourceChat.title,
    }] : []);
  })), [chats]);
  const visibleChats = useMemo(
    () =>
      chats.filter(
        (item) =>
          !item.archived &&
          !item.folderId &&
          !item.workspaceId &&
          !item.temporary &&
          item.messages.length > 0 &&
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
    if (!isDesktopApp()) return;
    getVersion().then(setInstalledVersion).catch(() => setInstalledVersion(APP_VERSION));
  }, []);
  useEffect(() => {
    if (!isDesktopApp() || !settingsOpen || settingsTab !== "models") return;
    invoke<boolean>("ollama_status").then(setOllamaInstalled).catch(() => setOllamaInstalled(false));
  }, [settingsOpen, settingsTab]);
  useEffect(() => {
    saveChats(chats);
  }, [chats]);
  useEffect(() => {
    setAgentAccessOpen(false);
    setAgentAccessClosing(false);
    approvalResolverRef.current?.(false);
    approvalResolverRef.current = null;
    setAgentApproval(null);
  }, [active]);
  useEffect(() => {
    if (startupChatReadyRef.current) return;
    startupChatReadyRef.current = true;
    const existing = chats.find((item) => !item.archived && !item.folderId && !item.workspaceId && !item.temporary && item.messages.length === 0);
    if (existing) { setActive(existing.id); return; }
    const id = Date.now();
    setChats((current) => [{ id, title: "New conversation", time: "Today", messages: [] }, ...current]);
    setActive(id);
  }, []);
  useEffect(() => {
    localStorage.setItem("idk-nova-folders", JSON.stringify(folders));
  }, [folders]);
  useEffect(() => {
    localStorage.setItem("idk-nova-workspaces", JSON.stringify(workspaces));
  }, [workspaces]);
  useEffect(() => {
    if (!isDesktopApp()) return;
    const timer = window.setTimeout(() => {
      for (const workspace of workspaces) {
        const projectChats = chats.filter((item) => item.workspaceId === workspace.id && item.messages.length > 0 && !item.temporary);
        const activity = projectChats.flatMap((item) => item.messages.map((message, index) => ({
          chatId: item.id, chatTitle: item.title, index, role: message.role,
          createdAt: item.id + index, summary: message.content.slice(0, 180),
        })));
        invoke("save_workspace_history", {
          rootPath: workspace.rootPath,
          chatsJson: JSON.stringify(projectChats),
          activityJson: JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), activity }, null, 2),
        }).catch(() => undefined);
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [chats, workspaces]);
  useEffect(() => {
    localStorage.setItem("idk-nova-browser-width", JSON.stringify(browserWidth));
  }, [browserWidth]);
  useEffect(() => {
    const adaptBrowser = () => {
      if (!browserOpen || browserMaximized) return;
      const available = window.innerWidth - (sidebar ? 272 : 0);
      if (available < 760) setBrowserMaximized(true);
      else setBrowserWidth((width) => Math.max(320, Math.min(width, available - 380)));
    };
    window.addEventListener("resize", adaptBrowser);
    return () => window.removeEventListener("resize", adaptBrowser);
  }, [browserOpen, browserMaximized, sidebar]);
  useEffect(() => {
    if (!isDesktopApp()) return;
    let cancelled = false;
    const syncNativeBrowser = async () => {
      const views = nativeBrowserViewsRef.current;
      const overlayOpen = Boolean(chatDialog || folderDialog || workspaceDelete || settingsOpen || selectionToolbar);
      for (const [id, entry] of views) {
        if (!browserOpen || overlayOpen || id !== activeBrowserTabId) await entry.webview.hide().catch(() => undefined);
      }
      if (!browserOpen || overlayOpen || activeBrowserTab?.kind !== "browser" || !activeBrowserTab.url || !browserSurfaceRef.current) return;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 120));
      if (cancelled || !browserSurfaceRef.current) return;
      const rect = browserSurfaceRef.current.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
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
  }, [browserOpen, activeBrowserTabId, activeBrowserTab?.url, browserFrameKey, browserWidth, browserMaximized, chatDialog, folderDialog, workspaceDelete, settingsOpen, selectionToolbar]);
  useEffect(() => () => {
    for (const entry of nativeBrowserViewsRef.current.values()) entry.webview.close().catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!isDesktopApp() || !browserOpen || !browserSurfaceRef.current) return;
    const surface = browserSurfaceRef.current;
    const observer = new ResizeObserver(() => {
      const entry = nativeBrowserViewsRef.current.get(activeBrowserTabId);
      if (!entry) return;
      const rect = surface.getBoundingClientRect();
      entry.webview.setPosition(new LogicalPosition(rect.left, rect.top)).catch(() => undefined);
      entry.webview.setSize(new LogicalSize(Math.max(1, rect.width), Math.max(1, rect.height))).catch(() => undefined);
    });
    observer.observe(surface);
    return () => observer.disconnect();
  }, [browserOpen, activeBrowserTabId]);
  useEffect(
    () => {
      localStorage.setItem("idk-nova-active", JSON.stringify(active));
    },
    [active],
  );
  useEffect(() => {
    if (!stickToBottomRef.current || !conversationRef.current) return;
    const frame = requestAnimationFrame(() => {
      if (conversationRef.current) conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [chat?.messages, busy]);
  useEffect(() => {
    stickToBottomRef.current = true;
    setShowJumpToBottom(false);
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "auto", block: "end" }));
  }, [active]);
  useEffect(() => {
    if (!busy) return;
    const updateElapsed = () => setResponseElapsedMs(Date.now() - responseStartedRef.current);
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 100);
    return () => window.clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    if (!browserTabs.some((tab) => tab.kind === "temporary" && tab.busy)) return;
    const timer = window.setInterval(() => setWorkspaceClock(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [browserTabs.some((tab) => tab.kind === "temporary" && tab.busy)]);
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
    const existing = chats.find((item) => !item.archived && !item.folderId && !item.workspaceId && !item.temporary && item.messages.length === 0);
    if (existing) { setActive(existing.id); setText(""); return; }
    const id = Date.now();
    setChats((current) => [
      { id, title: "New conversation", time: "Today", messages: [] },
      ...current,
    ]);
    setActive(id);
    setText("");
  };
  const startTemporaryChat = () => {
    if (chat.workspaceId) { setToast("Work chats remain attached to their workspace"); return; }
    setBrowserOpen(false);
    setBrowserMaximized(false);
    if (chat.temporary) {
      const restoredTitle = chat.messages.find((message) => message.role === "user")?.content.slice(0, 36) || "New conversation";
      setChats((items) => items.map((item) => item.id === chat.id ? { ...item, temporary: false, title: restoredTitle } : item));
      setToast("Temporary chat turned off · this conversation will be saved");
      return;
    }
    setChats((items) => items.map((item) => item.id === chat.id ? { ...item, temporary: true, title: "Temporary chat" } : item));
    setAgentAccessOpen(false);
    setText(""); setFiles([]); setReplyQuote("");
  };
  const createWorkspace = async () => {
    if (!isDesktopApp()) {
      setToast("Local Workspaces are available in the Nova desktop app");
      return;
    }
    try {
      const selected = await open({ directory: true, multiple: false, title: "Choose a folder for Nova Work" });
      if (!selected || Array.isArray(selected)) return;
      setWorkspaceLoading(true);
      const scan = await invoke<WorkspaceScan>("scan_workspace", { rootPath: selected });
      const name = selected.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "Workspace";
      const existing = workspaces.find((workspace) => workspace.rootPath === selected);
      const candidate: WorkProject = existing || { id: `work-${Date.now()}`, name, rootPath: selected, createdAt: Date.now(), fileCount: scan.entries.filter((entry) => entry.kind === "file").length, truncated: scan.truncated };
      const portable = await invoke<PortableWorkspace>("initialize_workspace", { rootPath: selected, projectJson: JSON.stringify({ version: 1, ...candidate }, null, 2) });
      let storedProject = candidate;
      let storedChats: Chat[] = [];
      try {
        const portableProject = JSON.parse(portable.projectJson);
        storedProject = {
          ...candidate,
          ...portableProject,
          rootPath: selected,
          fileCount: candidate.fileCount,
          truncated: scan.truncated,
          agentAccess: portableProject.agentAccess === "auto" ? "auto" : portableProject.agentAccess === "safe" ? "safe" : "ask",
        };
      } catch { /* use the safe local candidate */ }
      try { storedChats = (JSON.parse(portable.chatsJson) as Chat[]).filter((item) => item && typeof item.id === "number").map((item) => ({ ...item, workspaceId: storedProject.id, messages: Array.isArray(item.messages) ? item.messages.map((message) => ({ ...message, generating: false })) : [] })); } catch { /* empty portable history */ }
      const project = storedProject;
      setWorkspaces((current) => existing ? current.map((item) => item.id === existing.id ? { ...item, fileCount: project.fileCount, truncated: scan.truncated } : item) : [...current, project]);
      if (storedChats.length) setChats((current) => [...storedChats.filter((portableChat) => !current.some((item) => item.id === portableChat.id)), ...current]);
      setOpenWorkspaceId(project.id);
      setOpenFolderId(null);
      setWorkspacesOpen(false);
      if (storedChats.length) setActive(storedChats[0].id);
      else if (!chats.some((item) => item.workspaceId === project.id)) {
        const id = Date.now();
        setChats((current) => [{ id, title: "New work chat", time: "Today", messages: [], workspaceId: project.id }, ...current]);
        setActive(id);
      }
      setToast(`${name} is ready · ${project.fileCount} files indexed locally`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    } finally { setWorkspaceLoading(false); }
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
  const deleteWorkspace = (project: WorkProject) => {
    const removedIds = new Set(chats.filter((item) => item.workspaceId === project.id).map((item) => item.id));
    const remaining = chats.filter((item) => item.workspaceId !== project.id);
    setWorkspaces((current) => current.filter((item) => item.id !== project.id));
    setChats(remaining.length ? remaining : starterChats);
    if (removedIds.has(active)) setActive(remaining[0]?.id || starterChats[0].id);
    if (openWorkspaceId === project.id) setOpenWorkspaceId(null);
    setBrowserTabs((tabs) => tabs.filter((tab) => tab.projectId !== project.id));
    setWorkspaceDelete(null);
    setToast("Workspace and its chats removed from Nova · project files were not deleted");
  };
  const moveChat = (chatId: number, folderId?: string) => {
    const target = chats.find((item) => item.id === chatId);
    if (target?.workspaceId) {
      setChatMenu(null);
      setToast("Work chats stay inside their original workspace");
      return;
    }
    setChats((current) => current.map((item) => item.id === chatId ? { ...item, folderId } : item));
    setChatMenu(null);
    setToast(folderId ? "Conversation moved" : "Removed from folder");
  };
  const closeAgentAccess = () => {
    if (!agentAccessOpen || agentAccessClosing) return;
    setAgentAccessClosing(true);
    window.setTimeout(() => { setAgentAccessOpen(false); setAgentAccessClosing(false); }, 170);
  };
  const requestAgentApproval = (approval: NonNullable<AgentApproval>) => new Promise<boolean>((resolve) => {
    approvalResolverRef.current = resolve;
    setAgentApproval(approval);
  });
  const resolveAgentApproval = (approved: boolean) => {
    const resolve = approvalResolverRef.current;
    approvalResolverRef.current = null;
    setAgentApproval(null);
    resolve?.(approved);
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
      const workspaceEdge = browserOpen && !browserMaximized
        ? window.innerWidth - browserWidth
        : window.innerWidth;
      setSelectionToolbar({
        text: text.slice(0, 4000),
        x: Math.max(86, Math.min(workspaceEdge - 86, rect.left + rect.width / 2)),
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
    const id = `artifact-${Date.now()}`;
    setBrowserTabs((tabs) => [...tabs, { id, kind: "artifact", title, language, content, artifactView: "edit", url: "", input: "", history: [], historyIndex: -1 }]);
    setActiveBrowserTabId(id);
    setBrowserOpen(true);
  };
  const openDocumentArtifact = (document: DocumentArtifact, view: "edit" | "preview" = "preview") => {
    const id = `${document.kind}-${Date.now()}`;
    setBrowserTabs((tabs) => [...tabs, {
      id,
      kind: document.kind,
      title: document.title,
      subject: document.subject,
      content: document.body,
      artifactView: view,
      documentFont: "sans",
      documentSize: 14,
      documentAlign: "start",
      url: "",
      input: "",
      history: [],
      historyIndex: -1,
    }]);
    setActiveBrowserTabId(id);
    setBrowserOpen(true);
  };
  const openWorkspaceImage = (name: string, imageUrl: string) => {
    const id = `image-${Date.now()}`;
    setBrowserTabs((tabs) => [...tabs, { id, kind: "image", title: name || "Image", imageUrl, imageZoom: 1, url: "", input: "", history: [], historyIndex: -1 }]);
    setActiveBrowserTabId(id);
    setBrowserOpen(true);
  };
  const openEmailDraft = async (subject: string, body: string) => {
    const plainBody = body.replace(/\*\*/g, "").replace(/\\\n/g, "\n");
    const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(plainBody)}`;
    if (isDesktopApp()) await openUrl(mailto);
    else window.location.href = mailto;
  };
  const downloadWorkspaceImage = () => {
    if (activeBrowserTab?.kind !== "image" || !activeBrowserTab.imageUrl) return;
    const link = document.createElement("a");
    link.href = activeBrowserTab.imageUrl;
    link.download = activeBrowserTab.title || "nova-image";
    link.click();
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
    let title = "Search";
    try { title = new URL(target).hostname.replace(/^www\./, "") || "Search"; } catch { /* search URL */ }
    if (openInNewTab || activeBrowserTab?.kind !== "browser") {
      const id = `tab-${Date.now()}`;
      setBrowserTabs((tabs) => [...tabs, { id, kind: "browser", title, url: target, input: target, history: [target], historyIndex: 0 }]);
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
    if (available < 760) setBrowserMaximized(true);
    else setBrowserWidth((width) => Math.max(320, Math.min(width, available - 380)));
    setBrowserOpen(true);
  };
  const openSystemBrowser = async () => {
    if (!activeBrowserTab?.url) return;
    if (isDesktopApp()) await openUrl(activeBrowserTab.url);
    else window.open(activeBrowserTab.url, "_blank", "noopener,noreferrer");
  };
  const updateBrowserInput = (input: string) => setBrowserTabs((tabs) => tabs.map((tab) => tab.id === activeBrowserTabId ? { ...tab, input } : tab));
  const addWorkspaceHomeTab = () => {
    const id = `workspace-${Date.now()}`;
    setBrowserTabs((tabs) => [...tabs, { id, kind: "home", title: "Workspace", url: "", input: "", history: [], historyIndex: -1 }]);
    setActiveBrowserTabId(id);
  };
  const addBrowserTab = () => {
    const id = `tab-${Date.now()}`;
    setBrowserTabs((tabs) => [...tabs, { id, kind: "browser", title: "New tab", url: "", input: "", history: [], historyIndex: -1 }]);
    setActiveBrowserTabId(id);
  };
  const addFilesTab = async () => {
    const id = `files-${Date.now()}`;
    const project = workspaces.find((item) => item.id === chat.workspaceId);
    if (project && isDesktopApp()) {
      try {
        const scan = await invoke<WorkspaceScan>("scan_workspace", { rootPath: project.rootPath });
        setBrowserTabs((tabs) => [...tabs, { id, kind: "projectfiles", title: project.name, projectId: project.id, entries: scan.entries, url: "", input: "", history: [], historyIndex: -1 }]);
      } catch (error) { setToast(error instanceof Error ? error.message : String(error)); return; }
    } else setBrowserTabs((tabs) => [...tabs, { id, kind: "files", title: "Files", url: "", input: "", history: [], historyIndex: -1 }]);
    setActiveBrowserTabId(id);
  };
  const addTemporaryChatTab = () => {
    const id = `temporary-${Date.now()}`;
    setBrowserTabs((tabs) => [...tabs, {
      id,
      kind: "temporary",
      title: "Temporary chat",
      url: "",
      input: "",
      history: [],
      historyIndex: -1,
      messages: [],
      draft: "",
      busy: false,
    }]);
    setActiveBrowserTabId(id);
  };
  const openTemporaryChat = () => {
    const existing = browserTabs.find((tab) => tab.kind === "temporary");
    if (existing) setActiveBrowserTabId(existing.id);
    else addTemporaryChatTab();
    setBrowserOpen(true);
  };
  const openProjectFile = async (tab: BrowserTab, entry: WorkspaceEntry) => {
    if (entry.kind !== "file" || !tab.projectId) return;
    const project = workspaces.find((item) => item.id === tab.projectId);
    if (!project) return;
    try {
      const content = await invoke<string>("read_workspace_file", { rootPath: project.rootPath, relativePath: entry.path });
      const extension = entry.name.split(".").pop() || "text";
      openArtifact(entry.name, extension, content);
    } catch (error) { setToast(error instanceof Error ? error.message : String(error)); }
  };
  const updateWorkspaceTab = (id: string, changes: Partial<BrowserTab>) =>
    setBrowserTabs((tabs) => tabs.map((tab) => tab.id === id ? { ...tab, ...changes } : tab));
  const sendTemporaryChat = async () => {
    const tab = browserTabs.find((item) => item.id === activeBrowserTabId);
    if (!tab || tab.kind !== "temporary" || tab.busy || !tab.draft?.trim()) return;
    if (!activeProvider || !config.activeModel) {
      setToast("Connect and select a model before sending a message");
      setDraftConfig(config);
      setSettingsTab("models");
      setSettingsOpen(true);
      return;
    }
    const user: Message = { role: "user", content: tab.draft.trim() };
    const conversation = [...(tab.messages || []), user];
    const startedAt = Date.now();
    updateWorkspaceTab(tab.id, {
      draft: "",
      busy: true,
      startedAt,
      messages: [...conversation, { role: "assistant", content: "", generating: true }],
    });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamCompletion(config, conversation, (token) => setBrowserTabs((tabs) => tabs.map((item) => {
        if (item.id !== tab.id) return item;
        const messages = [...(item.messages || [])];
        const last = messages.length - 1;
        messages[last] = { ...messages[last], content: messages[last].content + token };
        return { ...item, messages };
      })), controller.signal);
    } catch (error) {
      setBrowserTabs((tabs) => tabs.map((item) => {
        if (item.id !== tab.id) return item;
        const messages = [...(item.messages || [])];
        const last = messages.length - 1;
        messages[last] = {
          ...messages[last],
          content: controller.signal.aborted
            ? (messages[last].content || "Response stopped.")
            : `I couldn’t connect to ${config.activeModel}.\n\n${error instanceof Error ? error.message : "Unknown error"}`,
        };
        return { ...item, messages };
      }));
    } finally {
      abortRef.current = null;
      setBrowserTabs((tabs) => tabs.map((item) => {
        if (item.id !== tab.id) return item;
        const messages = [...(item.messages || [])];
        const last = messages.length - 1;
        if (last >= 0 && messages[last].role === "assistant") messages[last] = { ...messages[last], generating: false, durationMs: Date.now() - startedAt };
        return { ...item, messages, busy: false, startedAt: undefined };
      }));
    }
  };
  const closeBrowserTab = (id: string) => {
    const nativeView = nativeBrowserViewsRef.current.get(id);
    if (nativeView) {
      nativeView.webview.close().catch(() => undefined);
      nativeBrowserViewsRef.current.delete(id);
    }
    setBrowserTabs((tabs) => {
      if (tabs.length === 1) return [{ id: "start", kind: "home", title: "Workspace", url: "", input: "", history: [], historyIndex: -1 }];
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
  const setWorkspaceMaximized = (maximized: boolean) => {
    if (maximized) {
      setBrowserRestoring(false);
      setBrowserMaximized(true);
      return;
    }
    if (!browserMaximized) return;
    setBrowserRestoring(true);
    window.setTimeout(() => {
      setBrowserMaximized(false);
      setBrowserRestoring(false);
    }, 320);
  };
  const toggleWorkspaceMaximized = () => setWorkspaceMaximized(!browserMaximized);
  const startBrowserResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const originX = event.clientX;
    const reservedForChat = (sidebar ? 272 : 0) + 380;
    const largestSplit = Math.max(320, window.innerWidth - reservedForChat);
    const originWidth = browserMaximized ? largestSplit + 36 : browserWidth;
    let maximizedDuringDrag = browserMaximized;
    if (browserMaximized) {
      setWorkspaceMaximized(false);
      maximizedDuringDrag = false;
    }
    const resize = (moveEvent: PointerEvent) => {
      const requested = originWidth + originX - moveEvent.clientX;
      if (requested >= largestSplit + 36) {
        if (!maximizedDuringDrag) {
          setWorkspaceMaximized(true);
          maximizedDuringDrag = true;
        }
        return;
      }
      if (maximizedDuringDrag) {
        setWorkspaceMaximized(false);
        maximizedDuringDrag = false;
      }
      setBrowserWidth(Math.max(320, Math.min(requested, largestSplit)));
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
    if (activeBrowserTab?.kind !== "artifact") return;
    const extension = ({ javascript: "js", typescript: "ts", python: "py", html: "html", css: "css", json: "json", text: "txt" } as Record<string, string>)[(activeBrowserTab.language || "text").toLowerCase()] || "txt";
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([activeBrowserTab.content || ""], { type: "text/plain" }));
    link.download = `nova-artifact.${extension}`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const downloadTextArtifact = () => {
    if (!activeBrowserTab || !["document", "email"].includes(activeBrowserTab.kind)) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([activeBrowserTab.content || ""], { type: "text/plain;charset=utf-8" }));
    link.download = `${activeBrowserTab.title || "nova-document"}.txt`;
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
    stickToBottomRef.current = true;
    setShowJumpToBottom(false);
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
                { role: "assistant", content: "", generating: true },
              ],
            }
          : item,
      ),
    );
    setText("");
    setFiles([]);
    setReplyQuote("");
    responseStartedRef.current = Date.now();
    setResponseElapsedMs(0);
    setBusy(true);
    setAgentStatus(chat.workspaceId ? "Reviewing your request and project…" : "");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      let workspaceContext = "";
      const project = workspaces.find((item) => item.id === chat.workspaceId);
      if (project && isDesktopApp()) {
        const scan = await invoke<WorkspaceScan>("scan_workspace", { rootPath: project.rootPath });
        const matches = await invoke<WorkspaceMatch[]>("search_workspace", { rootPath: project.rootPath, query: user.content });
        const relevantPaths = [...new Set(matches.map((match) => match.path))].slice(0, 6);
        const snippets: string[] = [];
        let budget = 0;
        for (const relativePath of relevantPaths) {
          try {
            const content = await invoke<string>("read_workspace_file", { rootPath: project.rootPath, relativePath });
            const excerpt = content.slice(0, Math.max(0, 20_000 - budget));
            if (!excerpt) break;
            snippets.push(`--- ${relativePath} ---\n${excerpt}`);
            budget += excerpt.length;
            if (budget >= 20_000) break;
          } catch { /* inaccessible or non-text files stay out of model context */ }
        }
        const projectMemory = chats.filter((item) => item.workspaceId === project.id && item.id !== chat.id).slice(0, 6).map((item) => `CHAT: ${item.title}\n${item.messages.slice(-4).map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n")}`).join("\n\n").slice(0, 6_000);
        workspaceContext = `You are working inside the local Nova Work project "${project.name}". Only reason about this project and never claim a file was changed unless a Nova tool confirms it. Workspace agent access is "${project.agentAccess || "ask"}".\n\nPROJECT FILE INDEX:\n${scan.entries.slice(0, 400).map((entry) => `${entry.kind === "directory" ? "[dir]" : "[file]"} ${entry.path}`).join("\n")}\n\nRELEVANT FILE CONTENT:\n${snippets.join("\n\n") || "No matching text file was selected for this request."}\n\nPROJECT CHAT MEMORY:\n${projectMemory || "No earlier Work chats in this project."}`;
      }
      const appendToken = (token: string) =>
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
        );
      if (project && isDesktopApp()) {
        const executeAgentTool = async (call: AgentToolCall) => {
          let args: Record<string, string> = {};
          try { args = JSON.parse(call.function.arguments || "{}"); } catch { throw new Error("Tool arguments are not valid JSON"); }
          const access = project.agentAccess || "ask";
          const isBrowserAction = ["web_search", "open_url"].includes(call.function.name);
          const isFileChange = call.function.name === "write_file";
          const needsApproval = access === "ask" ? (isBrowserAction || isFileChange) : access === "safe" ? isFileChange : false;
          if (needsApproval) {
            const target = call.function.name === "write_file" ? (args.path || "a project file") : call.function.name === "web_search" ? (args.query || "the web") : (args.url || "a website");
            setAgentStatus("Waiting for your approval…");
            const approved = await requestAgentApproval({
              title: isFileChange ? "Nova wants to change a project file" : "Nova wants to use the browser",
              detail: isFileChange ? `Create or update: ${target}` : call.function.name === "web_search" ? `Search for: ${target}` : `Open: ${target}`,
              risk: isFileChange ? "file" : "browser",
            });
            if (!approved) throw new Error("__NOVA_PERMISSION_DENIED__");
          }
          setAgentStatus(call.function.name === "write_file" && args.path
            ? `Creating or updating ${args.path}…`
            : call.function.name === "read_file" && args.path
              ? `Reading ${args.path}…`
              : call.function.name === "web_search" && args.query
                ? `Searching for “${args.query.slice(0, 70)}”…`
                : call.function.name === "open_url" && args.url
                  ? `Opening ${args.url.slice(0, 80)}…`
                  : agentStepLabel(call.function.name));
          if (call.function.name === "list_files") {
            const scan = await invoke<WorkspaceScan>("scan_workspace", { rootPath: project.rootPath });
            return { ok: true, files: scan.entries.slice(0, 1000) };
          }
          if (call.function.name === "read_file") return { ok: true, path: args.path, content: await invoke<string>("read_workspace_file", { rootPath: project.rootPath, relativePath: args.path }) };
          if (call.function.name === "write_file") {
            const path = await invoke<string>("write_workspace_file", { rootPath: project.rootPath, relativePath: args.path, content: args.content || "" });
            return { ok: true, path, backupCreated: true };
          }
          if (call.function.name === "web_search") { navigateBrowser(args.query || "", true); return { ok: true, message: "Search opened in Nova Workspace Browser" }; }
          if (call.function.name === "open_url") {
            const url = new URL(args.url); if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP and HTTPS URLs are allowed");
            navigateBrowser(url.toString(), true); return { ok: true, url: url.toString() };
          }
          throw new Error(`Unknown tool: ${call.function.name}`);
        };
        try {
          await runAgentCompletion(config, [...chat.messages, user], `${workspaceContext}\n\nYou may use Nova tools. Never perform purchases, authentication, form submission, deletion, or access outside the project.`, agentTools, executeAgentTool, (step) => setAgentStatus(agentStepLabel(step)), appendToken, controller.signal);
        } catch (agentError) {
          const detail = agentError instanceof Error ? agentError.message : String(agentError);
          if (detail.includes("__NOVA_PERMISSION_DENIED__")) {
            setChats((items) => items.map((item) => item.id === active ? { ...item, messages: item.messages.map((message, index) => index === item.messages.length - 1 ? { ...message, content: "Permission was not granted. The requested action was cancelled." } : message) } : item));
            return;
          }
          if (!/400|tools|tool_choice|tool call/i.test(detail)) throw agentError;
          setToast("This provider does not support Agent tools yet · using normal Work chat");
          await streamCompletion(config, [...chat.messages, user], appendToken, controller.signal, workspaceContext);
        }
      } else await streamCompletion(config, [...chat.messages, user], appendToken, controller.signal, workspaceContext);
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
      const durationMs = Math.max(0, Date.now() - responseStartedRef.current);
      setChats((items) => items.map((item) => item.id === active ? {
        ...item,
        messages: item.messages.map((message, index) => index === item.messages.length - 1 && message.role === "assistant" ? { ...message, generating: false, durationMs } : message),
      } : item));
      abortRef.current = null;
      approvalResolverRef.current = null;
      setAgentApproval(null);
      setAgentStatus("");
      setBusy(false);
    }
  };
  const stopResponse = () => {
    approvalResolverRef.current?.(false);
    approvalResolverRef.current = null;
    setAgentApproval(null);
    abortRef.current?.abort();
  };
  const jumpToLatest = () => {
    const node = conversationRef.current;
    if (!node) return;
    stickToBottomRef.current = false;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    window.setTimeout(() => {
      if (!conversationRef.current) return;
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
      stickToBottomRef.current = true;
      setShowJumpToBottom(false);
    }, 520);
  };
  const key = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };
  const openSettings = () => {
    setDraftConfig(config);
    setModelSetupView("list");
    setSettingsOpen(true);
    setModelOpen(false);
  };
  const beginModelSetup = (view: "choose" | "api" | "local" = "choose") => {
    setNewProvider({ id: `provider-${Date.now()}`, name: "", baseUrl: "", apiKey: "", models: [] });
    setManualModel("");
    setOllamaInstall(null);
    setPendingGgufPath("");
    setModelSetupView(view);
  };
  const addApiModel = async () => {
    const provider: Provider = {
      ...newProvider,
      name: newProvider.name.trim() || "Custom API",
      baseUrl: newProvider.baseUrl.trim().replace(/\/$/, ""),
    };
    if (!provider.baseUrl) { setToast("Enter the provider Base URL"); return; }
    setSyncingId(provider.id);
    try {
      const requestedModel = manualModel.trim();
      const models = requestedModel ? [requestedModel] : await discoverModels(provider);
      if (!models.length) throw new Error("The provider returned no models");
      const model = requestedModel || models[0];
      const latency = await testModel({ ...provider, models }, model);
      const readyProvider = { ...provider, models };
      setDraftConfig((current) => ({
        ...current,
        providers: [...current.providers, readyProvider],
        activeProviderId: readyProvider.id,
        activeModel: model,
      }));
      setVerifiedModels((current) => ({ ...current, [`${readyProvider.id}:${model}`]: latency }));
      setModelSetupView("list");
      setManualModel("");
      setToast(`${model} connected and verified · ${latency} ms`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not connect this model");
    } finally {
      setSyncingId("");
    }
  };
  const removeModel = (providerId: string, model: string) => {
    setDraftConfig((current) => {
      const source = current.providers.find((provider) => provider.id === providerId);
      if (!source) return current;
      const remainingModels = source.models.filter((value) => value !== model);
      const providers = remainingModels.length
        ? current.providers.map((provider) => provider.id === providerId ? { ...provider, models: remainingModels } : provider)
        : current.providers.filter((provider) => provider.id !== providerId);
      const removingActive = current.activeProviderId === providerId && current.activeModel === model;
      const fallback = providers.find((provider) => provider.models.length);
      return removingActive
        ? { ...current, providers, activeProviderId: fallback?.id || "", activeModel: fallback?.models[0] || "" }
        : { ...current, providers };
    });
    setVerifiedModels((current) => {
      const next = { ...current };
      delete next[`${providerId}:${model}`];
      return next;
    });
  };
  const verifyProviderModel = async (provider: Provider, model: string) => {
    setTestingModel(`${provider.id}:${model}`);
    try {
      const latency = await testModel(provider, model);
      setVerifiedModels((current) => ({ ...current, [`${provider.id}:${model}`]: latency }));
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
    const installed = await invoke<boolean>("ollama_status").catch(() => false);
    setOllamaInstalled(installed);
    if (!installed) {
      setPendingGgufPath(String(selected));
      setOllamaInstall({ phase: "missing", message: "Ollama is required to run GGUF models", downloaded: 0, total: 0, error: "" });
      return;
    }
    await finishLocalModelImport(String(selected));
  };
  const finishLocalModelImport = async (selected: string) => {
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
      const verifiedProvider: Provider = {
        ...(existing || { id: providerId, name: "Ollama Local", apiKey: "", models: [] }),
        baseUrl: "http://127.0.0.1:11434/v1",
        models: [...new Set([...(existing?.models || []), model])],
      };
      const latency = await testModel(verifiedProvider, model);
      const providers = existing
        ? draftConfig.providers.map((provider) =>
            provider.id === existing.id
              ? verifiedProvider
              : provider,
          )
        : [...draftConfig.providers, verifiedProvider];
      const nextConfig: Config = {
        ...draftConfig,
        providers,
        activeProviderId: providerId,
        activeModel: model,
      };
      setDraftConfig(nextConfig);
      setConfig(nextConfig);
      saveConfig(nextConfig);
      setVerifiedModels((current) => ({ ...current, [`${providerId}:${model}`]: latency }));
      setModelSetupView("list");
      setToast(`${model} imported, verified, and ready · ${latency} ms`);
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "Local model import failed",
      );
    } finally {
      setImportingLocalModel(false);
    }
  };
  const installOllama = async () => {
    setOllamaInstall({ phase: "starting", message: "Preparing official Ollama installer", downloaded: 0, total: 0, error: "" });
    const channel = new Channel<{ event: "status" | "progress"; data: any }>();
    channel.onmessage = (event) => setOllamaInstall((current) => {
      const base = current || { phase: "starting", message: "Preparing Ollama", downloaded: 0, total: 0, error: "" };
      return event.event === "progress" ? { ...base, phase: "downloading", downloaded: event.data.downloaded, total: event.data.total } : { ...base, phase: event.data.phase, message: event.data.message };
    });
    try {
      await invoke("install_ollama", { onEvent: channel });
      setOllamaInstalled(true);
      setOllamaInstall((current) => ({ ...(current || { downloaded: 0, total: 0, error: "" }), phase: "ready", message: "Ollama installed and ready", error: "" }));
      if (pendingGgufPath) { const path = pendingGgufPath; setPendingGgufPath(""); await finishLocalModelImport(path); }
    } catch (error) {
      setOllamaInstall((current) => ({ ...(current || { phase: "error", message: "Installation failed", downloaded: 0, total: 0, error: "" }), phase: "error", error: error instanceof Error ? error.message : String(error) }));
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
        isNewerVersion(manifest.version, installedVersion) ? "available" : "latest",
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
    if (Date.now() - configExportRef.current < 1000) {
      setToast("Configuration download already started");
      return;
    }
    configExportRef.current = Date.now();
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
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    setToast("Configuration downloaded to your Downloads folder");
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
    const next = draftConfig.providers.length ? draftConfig : { ...draftConfig, activeProviderId: "", activeModel: "" };
    setConfig(next);
    saveConfig(next);
    setSettingsOpen(false);
    setToast("Settings saved");
  };
  const activeFolder = folders.find((folder) => folder.id === openFolderId);
  const activeWorkspace = workspaces.find((workspace) => workspace.id === openWorkspaceId);
  const freshInFolder = () => {
    if (!activeFolder) return fresh();
    const existing = chats.find((item) => !item.archived && item.folderId === activeFolder.id && !item.temporary && item.messages.length === 0);
    if (existing) { setActive(existing.id); setText(""); return; }
    const id = Date.now();
    setChats((current) => [
      { id, title: "New conversation", time: "Today", messages: [], folderId: activeFolder.id },
      ...current,
    ]);
    setActive(id);
    setText("");
  };
  const freshInWorkspace = () => {
    if (!activeWorkspace) return fresh();
    const existing = chats.find((item) => !item.archived && item.workspaceId === activeWorkspace.id && !item.temporary && item.messages.length === 0);
    if (existing) { setActive(existing.id); setText(""); return; }
    const id = Date.now();
    setChats((current) => [{ id, title: "New work chat", time: "Today", messages: [], workspaceId: activeWorkspace.id }, ...current]);
    setActive(id);
    setText("");
  };
  const renderChatRows = (items: Chat[]) => ["Today", "Yesterday", "Previous 7 days"].map((group) => (
    <section key={group}>
      <h5>{group}</h5>
      {items.filter((item) => item.time === group && item.messages.length > 0 && !item.temporary).map((item) => (
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
  const renderInlineMarkdown = (value: string) => value.split(/(\*\*[^*\n]+\*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s<)]+)/g).map((piece, pieceIndex) => {
    const bold = piece.match(/^\*\*(.+)\*\*$/);
    if (bold) return <strong key={pieceIndex}>{bold[1]}</strong>;
    const markdownLink = piece.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    const target = markdownLink?.[2] || (/^https?:\/\//i.test(piece) ? piece : "");
    return target ? <a href={target} key={pieceIndex} onClick={(event) => { event.preventDefault(); navigateBrowser(target, true); }}>{markdownLink?.[1] || piece}</a> : piece;
  });
  const renderProse = (value: string, key: string | number) => (
    <span className="prose-segment" key={key}>
      {value.split("\n").map((line, lineIndex, lines) => {
        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        return <Fragment key={lineIndex}>
          {heading ? <strong className={`markdown-heading level-${Math.min(heading[1].length, 3)}`}>{renderInlineMarkdown(heading[2])}</strong> : renderInlineMarkdown(line)}
          {lineIndex < lines.length - 1 && "\n"}
        </Fragment>;
      })}
    </span>
  );
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
              <button onClick={() => replyToSelection(part.content)}><Reply />Reply</button>
              <button onClick={() => openArtifact(`${part.language} artifact`, part.language, part.content)}><Pencil />Edit</button>
              <button onClick={() => openArtifact(`${part.language} artifact`, part.language, part.content)}><Maximize2 />Full screen</button>
            </div>
          </header>
          <pre><code>{part.content}</code></pre>
        </section>
      ) : (() => {
        const document = detectDocumentArtifact(part.content);
        if (!document) return renderProse(part.content, index);
        return <div className="document-artifact-wrap" key={index}>
          {document.before && renderProse(document.before, "before")}
          <section className="document-artifact" dir="auto">
            <header>
              <span>{document.kind === "email" ? <Mail /> : <FileText />}<b>{document.kind === "email" ? "Email draft" : "Document"}</b>{document.subject && <small>{document.subject}</small>}</span>
              <div>
                <button onClick={() => copy(document.body)}><Copy />Copy</button>
                <button onClick={() => openDocumentArtifact(document, "edit")}><Pencil />Edit</button>
                <button onClick={() => openDocumentArtifact(document, "preview")}><Maximize2 />Full screen</button>
                {document.kind === "email" && <button className="email-action" onClick={() => openEmailDraft(document.subject, document.body)}><Mail />Email</button>}
              </div>
            </header>
            {document.subject && <div className="document-subject"><small>Subject</small><strong>{document.subject}</strong></div>}
            <div className="document-body">{renderProse(document.body, "document-body")}</div>
          </section>
          {document.after && renderProse(document.after, "after")}
        </div>;
      })())}
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
          <div className={`sidebar-track ${activeFolder || activeWorkspace ? "inside-folder" : ""}`}>
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
                          <button onClick={() => { setOpenFolderId(folder.id); setOpenWorkspaceId(null); setFoldersOpen(false); }}>
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
                <button onClick={() => setWorkspacesOpen(!workspacesOpen)}>
                  <BriefcaseBusiness /><span>Work</span>
                  {workspaceLoading ? <RefreshCw className="spin" /> : <ChevronRight className={workspacesOpen ? "open" : ""} />}
                </button>
                <div className={`folder-list work-list ${workspacesOpen ? "open" : ""}`} aria-hidden={!workspacesOpen}>
                  <div className="folder-heading"><span>Local workspaces</span><button title="Add workspace" onClick={createWorkspace}><FolderPlus /></button></div>
                  {workspaces.map((workspace) => <div className="folder-row" key={workspace.id}>
                    <button onClick={() => {
                      setOpenWorkspaceId(workspace.id); setOpenFolderId(null); setWorkspacesOpen(false);
                      const existingChat = chats.find((item) => !item.archived && item.workspaceId === workspace.id);
                      if (existingChat) setActive(existingChat.id);
                      else {
                        const id = Date.now();
                        setChats((current) => [{ id, title: "New work chat", time: "Today", messages: [], workspaceId: workspace.id }, ...current]);
                        setActive(id);
                      }
                      setText("");
                    }}>
                      <BriefcaseBusiness /><span>{workspace.name}</span><small>{workspace.fileCount}</small>
                    </button>
                    <button className="folder-edit" title="Workspace options" onClick={() => setWorkspaceDelete(workspace)}><MoreHorizontal /></button>
                  </div>)}
                  {!workspaces.length && <button className="empty-folder-action" onClick={createWorkspace}><FolderPlus /><span>Choose a project folder</span></button>}
                </div>
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
                const folderChats = chats.filter((item) => !item.archived && item.folderId === activeFolder.id && item.messages.length > 0 && !item.temporary);
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
              {activeWorkspace && (() => {
                const workspaceChats = chats.filter((item) => !item.archived && item.workspaceId === activeWorkspace.id && item.messages.length > 0 && !item.temporary);
                return <>
                  <div className="folder-view-head"><button className="folder-back" onClick={() => setOpenWorkspaceId(null)}><ArrowRight /><span>Back</span></button><div className="work-head-actions"><button title="Refresh workspace" onClick={async () => { try { setWorkspaceLoading(true); const scan = await invoke<WorkspaceScan>("scan_workspace", { rootPath: activeWorkspace.rootPath }); setWorkspaces((items) => items.map((item) => item.id === activeWorkspace.id ? { ...item, fileCount: scan.entries.filter((entry) => entry.kind === "file").length, truncated: scan.truncated } : item)); setToast("Workspace index refreshed"); } catch (error) { setToast(String(error)); } finally { setWorkspaceLoading(false); } }}><RefreshCw className={workspaceLoading ? "spin" : ""} /></button><button title="Remove workspace" onClick={() => setWorkspaceDelete(activeWorkspace)}><MoreHorizontal /></button></div></div>
                  <div className="folder-hero work-hero"><span><BriefcaseBusiness /></span><div><b>{activeWorkspace.name}</b><small>{activeWorkspace.fileCount} files · Local access</small></div></div>
                  <div className="work-path" title={activeWorkspace.rootPath}><ShieldCheck />{activeWorkspace.rootPath}</div>
                  <button className="folder-new-chat" onClick={freshInWorkspace}><Plus />New work chat</button>
                  <div className="history folder-history">{renderChatRows(workspaceChats)}{!workspaceChats.length && <div className="folder-empty"><BriefcaseBusiness /><b>No work chats yet</b><span>Start a chat with project-aware context.</span></div>}</div>
                </>;
              })()}
            </div>
          </div>
        </div>
        <div className="profile-button">
          <span className="avatar">
            <CircleUserRound />
          </span>
          <span>
            <b>{config.branding.workspaceName}</b>
            <small>Private · Local-first</small>
          </span>
          <button className="profile-settings" aria-label="Open settings" title="Settings" onClick={openSettings}><Settings /></button>
        </div>
      </aside>
      <main className={`${chat.workspaceId ? "work-chat-main" : ""} ${chat.temporary ? "temporary-chat-main" : ""}`}>
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
            {chat.workspaceId && <span className="work-mode-pill"><BriefcaseBusiness /><span>{workspaces.find((item) => item.id === chat.workspaceId)?.name || "Work"}</span></span>}
          </div>
          <div className="chat-actions">
            <span className="tooltip">
              <button disabled={Boolean(chat.workspaceId)} className={`icon-button ${chat.temporary ? "active" : ""}`} aria-label="Temporary chat" onClick={startTemporaryChat}>
                {chat.temporary ? <Check /> : <Clock3 />}
              </button>
              <span>{chat.workspaceId ? "Work chats stay in their project" : chat.temporary ? "Turn off temporary chat" : "Start a temporary chat"}</span>
            </span>
            <button className={`icon-button workspace-button ${browserOpen ? "active" : ""}`} aria-label="Workspace" title="Workspace" onClick={() => {
              if (browserOpen) {
                setBrowserOpen(false);
                setBrowserMaximized(false);
              } else {
                const available = window.innerWidth - (sidebar ? 272 : 0);
                if (available < 760) setBrowserMaximized(true);
                else setBrowserWidth((width) => Math.max(320, Math.min(width, available - 380)));
                setBrowserOpen(true);
              }
            }}>
              <PanelsTopLeft />
            </button>
            <button className="share" onClick={share}>
              <Globe2 />
              Share
            </button>
          </div>
        </header>
        <div
          key={chat.id}
          className={`conversation chat-view-transition ${chat.workspaceId ? "work-conversation" : ""}`}
          ref={conversationRef}
          onWheel={(event) => { if (event.deltaY < 0) stickToBottomRef.current = false; }}
          onScroll={(event) => {
            const target = event.currentTarget;
            const awayFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight >= 240;
            stickToBottomRef.current = !awayFromBottom;
            setShowJumpToBottom(awayFromBottom);
          }}
        >
          {chat.messages.length === 0 ? (
            <div className="welcome">
              <div className="welcome-mark">
                <BrandMark config={config} />
              </div>
              <span className={`eyebrow ${chat.workspaceId ? "work-chat-badge" : ""} ${chat.temporary ? "temporary-badge" : ""}`}>{chat.temporary ? "TEMPORARY CHAT" : chat.workspaceId ? "LOCAL PROJECT · WORK MODE" : "PRIVATE AI WORKSPACE"}</span>
              <h1>{chat.temporary ? "Start a private session" : chat.workspaceId ? `Work on ${workspaces.find((item) => item.id === chat.workspaceId)?.name || "this project"}` : "How can I help?"}</h1>
              <p>
                {chat.temporary ? "This conversation disappears when you close or restart Nova and is never added to history." : chat.workspaceId ? "Nova can inspect relevant project files for this chat." : "Explore ideas, work with files, and talk to the models you trust."}
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
                      <div className="message-quote" dir="auto" title={message.quote}><Reply />{quotePreview(message.quote, 320)}</div>
                    )}
                    {message.attachments?.length ? (
                      <div className="attachments">
                        {message.attachments.map((attachment, itemIndex) =>
                          attachment.type.startsWith("image/") ? (
                            <button className="attachment-image" key={itemIndex} onClick={() => openWorkspaceImage(attachment.name, attachment.url)} title="Open image in Workspace">
                              <img src={attachment.url} alt={attachment.name} />
                            </button>
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
                        <div className="agent-progress"><span className="typing"><i /><i /><i /></span>{chat.workspaceId && agentStatus && <span>{agentStatus}</span>}</div>
                      )}
                    </div>
                    {message.role === "assistant" && message.content && (
                      <div className="message-actions">
                        <button disabled={message.generating} onClick={() => copy(message.content)}>
                          <Copy />
                          Copy
                        </button>
                        <button
                          disabled={message.generating}
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
                          {message.liked ? <CheckCheck /> : <Check />}
                          <span>Helpful</span>
                        </button>
                        {(message.generating || message.durationMs !== undefined) && <span className={`response-time ${message.generating ? "live" : ""}`}><Clock3 />Response {formatDuration(message.generating ? responseElapsedMs : (message.durationMs || 0))}</span>}
                      </div>
                    )}
                  </div>
                </article>
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>
        {showJumpToBottom && <button className={`jump-to-bottom ${busy ? "responding" : ""}`} onClick={jumpToLatest} aria-label="Jump to latest response" title="Jump to latest">
          {busy ? <span className="mini-typing"><i /><i /><i /></span> : <ChevronDown />}
        </button>}
        <div className="composer-zone">
          {chat.temporary && <div className="temporary-notice"><Clock3 /><span><b>Temporary chat</b><small>Not saved to history</small></span></div>}
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
              <div><b>Replying to selection</b><span title={replyQuote}>{quotePreview(replyQuote)}</span></div>
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
            {chatWorkspace && agentAccessOpen && <button className="agent-access-dismiss" aria-label="Close agent access menu" onClick={closeAgentAccess} />}
            {chatWorkspace && agentAccessOpen && (
              <div className={`agent-access-popover ${agentAccessClosing ? "closing" : ""}`} role="menu" aria-label="Agent access">
                <div className="agent-access-title"><span>How should Nova actions be approved?</span><small>Applies only to this Work project</small></div>
                {([
                  ["ask", "Ask for approval", "Ask before file changes and browser access", ShieldCheck],
                  ["safe", "Approve for me", "Ask only before potentially unsafe changes", Workflow],
                  ["auto", "Full access", "No prompts inside this project folder", Rocket],
                ] as const).map(([value, label, description, Icon]) => (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={(chatWorkspace.agentAccess || "ask") === value}
                    className={`${(chatWorkspace.agentAccess || "ask") === value ? "selected" : ""} ${value === "auto" ? "risk" : ""}`}
                    key={value}
                    onClick={() => {
                      setWorkspaces((items) => items.map((item) => item.id === chatWorkspace.id ? { ...item, agentAccess: value } : item));
                      closeAgentAccess();
                    }}
                  >
                    <Icon />
                    <span><b>{label}</b><small>{description}</small></span>
                    {(chatWorkspace.agentAccess || "ask") === value && <Check />}
                  </button>
                ))}
              </div>
            )}
            {agentApproval ? <div className="agent-approval-inline">
              <span className={`approval-icon ${agentApproval.risk}`}><ShieldCheck /></span>
              <span><b>{agentApproval.title}</b><small>{agentApproval.detail}</small></span>
              <div><button onClick={() => resolveAgentApproval(false)}>No</button><button className="approve" onClick={() => resolveAgentApproval(true)}>Yes</button></div>
            </div> : <textarea
              dir="auto"
              disabled={!config.activeModel}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={key}
              placeholder={config.activeModel ? `Message ${config.branding.appName}…` : "Choose a model before sending a message"}
              rows={1}
            />}
            <div className="composer-tools">
              <div>
                {chatWorkspace && (
                  <button
                    type="button"
                    className={`agent-access-trigger ${(chatWorkspace.agentAccess || "ask") === "auto" ? "full" : ""}`}
                    title="Agent access"
                    aria-label="Agent access"
                    aria-expanded={agentAccessOpen}
                    onClick={() => agentAccessOpen ? closeAgentAccess() : (setAgentAccessClosing(false), setAgentAccessOpen(true))}
                  >
                    <ShieldCheck />
                  </button>
                )}
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
              <div className="settings-scroll settings-tab-transition" key={settingsTab}>
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
                    {modelSetupView === "list" && <>
                      <div className="models-page-heading">
                        <div><h2>Your models</h2><p>Choose which AI Nova uses, test its connection, or remove it.</p></div>
                        <button className="primary-button" onClick={() => beginModelSetup()}><Plus />Add new model</button>
                      </div>
                      <div className="model-library">
                        {draftConfig.providers.flatMap((provider) => provider.models.map((model) => {
                          const key = `${provider.id}:${model}`;
                          const latency = verifiedModels[key];
                          const activeModel = draftConfig.activeProviderId === provider.id && draftConfig.activeModel === model;
                          return <div className={`model-library-row ${activeModel ? "active" : ""}`} key={key}>
                            <button className="model-library-main" onClick={() => setDraftConfig((current) => ({ ...current, activeProviderId: provider.id, activeModel: model }))}>
                              <span className="model-status"><Bot /></span>
                              <span><b>{model}</b><small>{provider.name} · {activeModel ? "Currently selected" : "Ready to use"}</small></span>
                            </button>
                            <div className="model-library-actions">
                              {latency && <span className="verified-label"><ShieldCheck />{latency} ms</span>}
                              <button className="test-button" disabled={testingModel === key} onClick={() => verifyProviderModel(provider, model)}>{testingModel === key ? "Testing…" : "Test"}</button>
                              <button className="icon-button subtle danger-icon" aria-label={`Remove ${model}`} onClick={() => removeModel(provider.id, model)}><Trash2 /></button>
                            </div>
                          </div>;
                        }))}
                        {!draftConfig.providers.some((provider) => provider.models.length) && <div className="models-empty-state"><Bot /><h3>No models added</h3><p>Add an API model or import a GGUF file when you are ready.</p><button className="primary-button" onClick={() => beginModelSetup()}><Plus />Add your first model</button></div>}
                      </div>
                    </>}
                    {modelSetupView === "choose" && <div className="model-setup-view">
                      <button className="setup-back" onClick={() => setModelSetupView("list")}><ChevronRight />Back to models</button>
                      <div className="setup-title"><h2>Add a new model</h2><p>How would you like to connect it?</p></div>
                      <div className="model-source-options">
                        <button onClick={() => setModelSetupView("api")}><span><Globe2 /></span><b>Connect an API</b><small>OpenAI-compatible cloud or local endpoint</small><ArrowRight /></button>
                        <button onClick={() => setModelSetupView("local")}><span><HardDriveUpload /></span><b>Import a local file</b><small>Run a GGUF model privately with Ollama</small><ArrowRight /></button>
                      </div>
                    </div>}
                    {modelSetupView === "api" && <div className="model-setup-view api-model-setup">
                      <button className="setup-back" onClick={() => setModelSetupView("choose")}><ChevronRight />Choose another method</button>
                      <div className="setup-title"><h2>Connect an API model</h2><p>Enter a fresh connection. Previously added model details are never reused here.</p></div>
                      <div className="clean-form">
                        <label>Connection name<input autoFocus value={newProvider.name} placeholder="Company AI" onChange={(event) => setNewProvider((current) => ({ ...current, name: event.target.value }))} /></label>
                        <label>Base URL<input value={newProvider.baseUrl} placeholder="https://api.example.com/v1" onChange={(event) => setNewProvider((current) => ({ ...current, baseUrl: event.target.value }))} /></label>
                        <label>API key <small className="optional">Optional for local servers</small><input type="password" value={newProvider.apiKey} placeholder="Paste API key" onChange={(event) => setNewProvider((current) => ({ ...current, apiKey: event.target.value }))} /></label>
                        <label>Model ID <small className="optional">Leave empty to discover automatically</small><input value={manualModel} placeholder="goldiran-auto" onChange={(event) => setManualModel(event.target.value)} /></label>
                        <button className="primary-button connect-model-button" disabled={!newProvider.baseUrl.trim() || syncingId === newProvider.id} onClick={addApiModel}><RefreshCw className={syncingId === newProvider.id ? "spinning" : ""} />{syncingId === newProvider.id ? "Testing connection…" : "Test & add model"}</button>
                      </div>
                    </div>}
                    {modelSetupView === "local" && <div className="model-setup-view local-model-setup">
                      <button className="setup-back" onClick={() => setModelSetupView("choose")}><ChevronRight />Choose another method</button>
                      <div className="setup-title"><h2>Import a local model</h2><p>Choose a GGUF file. Nova keeps a private copy and configures the local runtime for you.</p></div>
                      <button className="local-drop" disabled={importingLocalModel} onClick={importLocalModel}><HardDriveUpload /><span><b>{importingLocalModel ? "Importing and verifying…" : "Choose a GGUF file"}</b><small>Desktop app only · the original file is not modified</small></span></button>
                      {isDesktopApp() && ollamaInstalled === false && <div className="ollama-installer">
                        <div className="ollama-installer-head"><Info /><span><b>Ollama is required</b><small>Nova downloads the correct runtime for {navigator.platform.toLowerCase().includes("mac") ? "macOS" : "Windows"}.</small></span></div>
                        {ollamaInstall && ollamaInstall.phase !== "missing" && <div className="ollama-install-progress"><div><span>{ollamaInstall.message}</span><b>{ollamaInstall.total > 0 ? `${(ollamaInstall.downloaded / 1048576).toFixed(1)} / ${(ollamaInstall.total / 1048576).toFixed(1)} MB · ${Math.min(100, Math.round(ollamaInstall.downloaded / ollamaInstall.total * 100))}%` : ollamaInstall.downloaded > 0 ? `${(ollamaInstall.downloaded / 1048576).toFixed(1)} MB` : ollamaInstall.phase === "installing" ? "Installing…" : ""}</b></div><i><span style={{ width: `${ollamaInstall.total > 0 ? Math.min(100, ollamaInstall.downloaded / ollamaInstall.total * 100) : ollamaInstall.phase === "installing" ? 100 : 5}%` }} /></i>{ollamaInstall.error && <p>{ollamaInstall.error}</p>}</div>}
                        <button className="primary-button" disabled={Boolean(ollamaInstall && !["missing", "error"].includes(ollamaInstall.phase))} onClick={installOllama}><Download />{ollamaInstall && !["missing", "error"].includes(ollamaInstall.phase) ? "Installing Ollama…" : "Download & install Ollama"}</button>
                      </div>}
                      {ollamaInstalled && <div className="ollama-ready"><Check /><span><b>Local runtime ready</b><small>Your GGUF file can be imported now.</small></span></div>}
                    </div>}
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
                      Installed · {installedVersion}
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
                        <dd>{installedVersion}</dd>
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
      <aside
        className={`nova-browser ${browserOpen ? "" : "closed"} ${browserMaximized ? "maximized" : ""} ${browserRestoring ? "restoring" : ""}`}
        style={{ "--browser-width": `${browserWidth}px` } as CSSProperties}
        aria-label="Nova browser"
        aria-hidden={!browserOpen}
      >
          <div className="browser-resizer" onPointerDown={startBrowserResize}><span /></div>
          <div className="browser-tabs">
            <div>
              {browserTabs.map((tab) => (
                <button className={tab.id === activeBrowserTabId ? "active" : ""} key={tab.id} onClick={() => setActiveBrowserTabId(tab.id)} title={tab.title}>
                  {tab.kind === "browser" ? <Globe2 /> : tab.kind === "artifact" ? <Code2 /> : tab.kind === "document" ? <FileText /> : tab.kind === "email" ? <Mail /> : ["files", "projectfiles"].includes(tab.kind) ? <Folder /> : tab.kind === "temporary" ? <Clock3 /> : tab.kind === "image" ? <ImageIcon /> : <Sparkles />}
                  <span>{tab.title}</span><i onClick={(event) => { event.stopPropagation(); closeBrowserTab(tab.id); }}><X /></i>
                </button>
              ))}
            </div>
            <button className="new-browser-tab" onClick={addWorkspaceHomeTab} aria-label="New workspace tab" title="New workspace tab"><Plus /></button>
            <div className="browser-header-actions">
              {activeBrowserTab?.kind === "browser" && <button disabled={!activeBrowserTab.url} onClick={openSystemBrowser} title="Open in your default browser"><ExternalLink /></button>}
              <button onClick={toggleWorkspaceMaximized} title={browserMaximized ? "Restore split view" : "Full screen"}>{browserMaximized ? <Minimize2 /> : <Maximize2 />}</button>
              <button onClick={() => { setBrowserOpen(false); setBrowserMaximized(false); }} title="Close Workspace"><X /></button>
            </div>
          </div>
          {activeBrowserTab?.kind === "browser" ? <form className="browser-address" onSubmit={(event) => { event.preventDefault(); navigateBrowser(activeBrowserTab.input || ""); }}>
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
          </form> : activeBrowserTab?.kind === "artifact" ? (
            <div className="workspace-toolbar">
              <button className={activeBrowserTab.artifactView === "edit" ? "active" : ""} onClick={() => setBrowserTabs((tabs) => tabs.map((tab) => tab.id === activeBrowserTabId ? { ...tab, artifactView: "edit" } : tab))}><Pencil />Edit</button>
              <button className={activeBrowserTab.artifactView === "preview" ? "active" : ""} onClick={() => setBrowserTabs((tabs) => tabs.map((tab) => tab.id === activeBrowserTabId ? { ...tab, artifactView: "preview" } : tab))}><Globe2 />Preview</button>
              <span />
              <button onClick={() => copy(activeBrowserTab.content || "")}><Copy />Copy</button>
              <button onClick={downloadArtifact}><Download />Save</button>
            </div>
          ) : activeBrowserTab && ["document", "email"].includes(activeBrowserTab.kind) ? (
            <div className="workspace-toolbar document-toolbar">
              {activeBrowserTab.kind === "document" ? <>
                <button className={activeBrowserTab.artifactView === "edit" ? "active" : ""} onClick={() => updateWorkspaceTab(activeBrowserTab.id, { artifactView: "edit" })}><Pencil />Edit</button>
                <button className={activeBrowserTab.artifactView === "preview" ? "active" : ""} onClick={() => updateWorkspaceTab(activeBrowserTab.id, { artifactView: "preview" })}><FileText />Document</button>
                <select aria-label="Document font" value={activeBrowserTab.documentFont || "sans"} onChange={(event) => updateWorkspaceTab(activeBrowserTab.id, { documentFont: event.target.value as BrowserTab["documentFont"] })}>
                  <option value="sans">Sans</option><option value="serif">Serif</option><option value="mono">Mono</option>
                </select>
                <button aria-label="Decrease font size" onClick={() => updateWorkspaceTab(activeBrowserTab.id, { documentSize: Math.max(10, (activeBrowserTab.documentSize || 14) - 1) })}>A−</button>
                <button aria-label="Increase font size" onClick={() => updateWorkspaceTab(activeBrowserTab.id, { documentSize: Math.min(24, (activeBrowserTab.documentSize || 14) + 1) })}>A+</button>
                <button className={activeBrowserTab.documentAlign === "start" ? "active" : ""} aria-label="Align start" onClick={() => updateWorkspaceTab(activeBrowserTab.id, { documentAlign: "start" })}><AlignLeft /></button>
                <button className={activeBrowserTab.documentAlign === "center" ? "active" : ""} aria-label="Align center" onClick={() => updateWorkspaceTab(activeBrowserTab.id, { documentAlign: "center" })}><AlignCenter /></button>
                <button className={activeBrowserTab.documentAlign === "justify" ? "active" : ""} aria-label="Justify" onClick={() => updateWorkspaceTab(activeBrowserTab.id, { documentAlign: "justify" })}><AlignJustify /></button>
              </> : <button className="active"><Mail />Compose</button>}
              <span />
              {activeBrowserTab.kind === "document" && <small>{(activeBrowserTab.content || "").trim().split(/\s+/).filter(Boolean).length.toLocaleString()} words</small>}
              <button onClick={() => copy(activeBrowserTab.content || "")}><Copy />Copy</button>
              <button onClick={downloadTextArtifact}><Download />Save</button>
              {activeBrowserTab.kind === "email" && <button className="email-action" onClick={() => openEmailDraft(activeBrowserTab.subject || "", activeBrowserTab.content || "")}><Mail />Email</button>}
            </div>
          ) : activeBrowserTab?.kind === "image" ? (
            <div className="workspace-toolbar image-toolbar">
              <span>{Math.round((activeBrowserTab.imageZoom || 1) * 100)}%</span>
              <button onClick={() => updateWorkspaceTab(activeBrowserTab.id, { imageZoom: Math.max(.25, (activeBrowserTab.imageZoom || 1) - .25) })}><ZoomOut />Zoom out</button>
              <button onClick={() => updateWorkspaceTab(activeBrowserTab.id, { imageZoom: Math.min(4, (activeBrowserTab.imageZoom || 1) + .25) })}><ZoomIn />Zoom in</button>
              <button onClick={() => updateWorkspaceTab(activeBrowserTab.id, { imageZoom: 1 })}>Reset</button>
              <button onClick={downloadWorkspaceImage}><Download />Download</button>
            </div>
          ) : <div className="workspace-toolbar workspace-context"><span>{activeBrowserTab?.kind === "files" ? `${workspaceArtifacts.length} generated code file${workspaceArtifacts.length === 1 ? "" : "s"}` : activeBrowserTab?.kind === "projectfiles" ? `${activeBrowserTab.entries?.filter((entry) => entry.kind === "file").length || 0} project files · read-only` : activeBrowserTab?.kind === "temporary" ? "Temporary chat · cleared when this tab closes" : "Choose a workspace tool"}</span></div>}
          <div className="browser-surface" ref={browserSurfaceRef}>
            <div
              className={`workspace-view workspace-view-${activeBrowserTab?.kind || "home"}`}
              key={`${activeBrowserTab?.id}-${activeBrowserTab?.kind}-${activeBrowserTab?.url}-${activeBrowserTab?.historyIndex}-${activeBrowserTab?.artifactView || ""}-${browserFrameKey}`}
            >
            {activeBrowserTab?.kind === "browser" && activeBrowserTab.url ? (
              <>
                {!isDesktopApp() && <iframe key={`${activeBrowserTab.id}-${activeBrowserTab.url}-${browserFrameKey}`} title="Nova browser" src={activeBrowserTab.url} sandbox="allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-scripts allow-same-origin" />}
                <div className="browser-fallback">
                  <span>{isDesktopApp() ? "Native secure webview" : "Protected sites may require the system browser."}</span>
                  <button onClick={openSystemBrowser}><ExternalLink />Open externally</button>
                </div>
              </>
            ) : activeBrowserTab?.kind === "browser" ? (
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
            ) : activeBrowserTab?.kind === "artifact" ? (
              <div className="workspace-artifact">
                {activeBrowserTab.artifactView === "edit" ? (
                  <textarea spellCheck={activeBrowserTab.language === "text"} value={activeBrowserTab.content || ""} onChange={(event) => setBrowserTabs((tabs) => tabs.map((tab) => tab.id === activeBrowserTabId ? { ...tab, content: event.target.value } : tab))} />
                ) : activeBrowserTab.language?.toLowerCase() === "html" ? (
                  <iframe title="Artifact preview" sandbox="" srcDoc={activeBrowserTab.content || ""} />
                ) : <div className="document-preview" dir="auto">{activeBrowserTab.content}</div>}
              </div>
            ) : activeBrowserTab?.kind === "document" ? (
              <div className="workspace-document">
                {activeBrowserTab.artifactView === "edit" ? (
                  <textarea
                    dir="auto"
                    spellCheck
                    style={{ fontFamily: activeBrowserTab.documentFont === "serif" ? "Georgia, 'Times New Roman', serif" : activeBrowserTab.documentFont === "mono" ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "ui-sans-serif, system-ui, sans-serif", fontSize: activeBrowserTab.documentSize || 14, textAlign: activeBrowserTab.documentAlign || "start" }}
                    value={activeBrowserTab.content || ""}
                    onChange={(event) => updateWorkspaceTab(activeBrowserTab.id, { content: event.target.value })}
                  />
                ) : (
                  <article dir="auto"><header><FileText /><span><b>{activeBrowserTab.title}</b><small>{(activeBrowserTab.content || "").trim().split(/\s+/).filter(Boolean).length.toLocaleString()} words · Nova document</small></span></header><div style={{ fontFamily: activeBrowserTab.documentFont === "serif" ? "Georgia, 'Times New Roman', serif" : activeBrowserTab.documentFont === "mono" ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "ui-sans-serif, system-ui, sans-serif", fontSize: activeBrowserTab.documentSize || 14, textAlign: activeBrowserTab.documentAlign || "start" }}>{renderProse(activeBrowserTab.content || "", "workspace-document")}</div></article>
                )}
              </div>
            ) : activeBrowserTab?.kind === "email" ? (
              <div className="workspace-email">
                <article>
                  <header><Mail /><span><b>Email draft</b><small>Ready to review and send</small></span></header>
                  <label><span>To</span><input dir="auto" placeholder="Recipient email" /></label>
                  <label><span>Subject</span><input dir="auto" value={activeBrowserTab.subject || ""} onChange={(event) => updateWorkspaceTab(activeBrowserTab.id, { subject: event.target.value })} /></label>
                  <textarea dir="auto" spellCheck value={activeBrowserTab.content || ""} onChange={(event) => updateWorkspaceTab(activeBrowserTab.id, { content: event.target.value })} />
                  <footer><button onClick={() => openEmailDraft(activeBrowserTab.subject || "", activeBrowserTab.content || "")}><Mail />Open in email app</button></footer>
                </article>
              </div>
            ) : activeBrowserTab?.kind === "image" ? (
              <div className="workspace-image-viewer">
                <div><img src={activeBrowserTab.imageUrl} alt={activeBrowserTab.title} style={{ transform: `scale(${activeBrowserTab.imageZoom || 1})` }} /></div>
              </div>
            ) : activeBrowserTab?.kind === "files" ? (
              <div className="workspace-files">
                <header><div><h3>Generated files</h3><p>Every code block created in your conversations appears here.</p></div><button onClick={() => fileRef.current?.click()}><Paperclip />Attach</button></header>
                {workspaceArtifacts.length ? <div className="workspace-file-list">{workspaceArtifacts.map((artifact) => (
                  <button key={artifact.id} onClick={() => openArtifact(artifact.title, artifact.language, artifact.content)}>
                    <Code2 /><span><b>{artifact.title}</b><small>{artifact.chatTitle} · {artifact.language}</small></span><ArrowRight />
                  </button>
                ))}</div> : <div className="workspace-files-empty"><Folder /><h3>No generated files yet</h3><p>Ask your model to create code. Each code block will be collected here automatically.</p></div>}
                {files.length > 0 && <section className="workspace-attachments"><small>Current attachments</small>{files.map((file) => <article key={file.name}><FileText /><span>{file.name}</span></article>)}</section>}
              </div>
            ) : activeBrowserTab?.kind === "projectfiles" ? (
              <div className="workspace-files project-files">
                <header><div><span className="work-source-badge"><BriefcaseBusiness />Work files</span><h3>{activeBrowserTab.title}</h3><p>Select a supported source or text file to inspect it in Workspace.</p></div><button onClick={async () => { const project = workspaces.find((item) => item.id === activeBrowserTab.projectId); if (!project) return; const scan = await invoke<WorkspaceScan>("scan_workspace", { rootPath: project.rootPath }); updateWorkspaceTab(activeBrowserTab.id, { entries: scan.entries }); }}><RefreshCw />Refresh</button></header>
                <div className="project-file-list">{(activeBrowserTab.entries || []).map((entry) => <button className={entry.kind} key={entry.path} onClick={() => openProjectFile(activeBrowserTab, entry)} disabled={entry.kind === "directory"} title={entry.path}>{entry.kind === "directory" ? <Folder /> : <FileText />}<span><b>{entry.name}</b><small>{entry.path}{entry.kind === "file" ? ` · ${Math.max(1, Math.round(entry.size / 1024))} KB` : ""}</small></span>{entry.kind === "file" && <ArrowRight />}</button>)}</div>
              </div>
            ) : activeBrowserTab?.kind === "temporary" ? (
              <div className="workspace-sidechat">
                <div className="sidechat-conversation">
                  {!activeBrowserTab.messages?.length ? (
                    <div className="welcome temporary-welcome">
                      <span className="temporary-badge"><Clock3 />Temporary chat</span>
                      <h1>How can I help?</h1>
                      <p>This conversation disappears when you close this tab or refresh Nova.</p>
                    </div>
                  ) : <div className="message-list workspace-message-list">{activeBrowserTab.messages.map((message, index) => (
                    <article className={message.role} key={index}>
                      <div className="speaker">{message.role === "assistant" ? <BrandMark config={config} /> : <CircleUserRound />}</div>
                      <div className="message-body">
                        <div className="content">{message.content ? renderMessageContent(message) : <span className="typing"><i /><i /><i /></span>}</div>
                        {message.role === "assistant" && message.content && <div className="message-actions">
                          <button disabled={message.generating} onClick={() => copy(message.content)}><Copy />Copy</button>
                          <button disabled={message.generating} className={message.liked ? "selected" : ""} onClick={() => setBrowserTabs((tabs) => tabs.map((tab) => tab.id === activeBrowserTab.id ? { ...tab, messages: (tab.messages || []).map((item, itemIndex) => itemIndex === index ? { ...item, liked: !item.liked } : item) } : tab))}>
                            {message.liked ? <CheckCheck /> : <Check />}<span>Helpful</span>
                          </button>
                          {(message.generating || message.durationMs !== undefined) && <span className={`response-time ${message.generating ? "live" : ""}`}><Clock3 />Response {formatDuration(message.generating ? Math.max(0, workspaceClock - (activeBrowserTab.startedAt || workspaceClock)) : (message.durationMs || 0))}</span>}
                        </div>}
                      </div>
                    </article>
                  ))}</div>}
                </div>
                <div className="composer-zone workspace-composer-zone">
                  {!config.activeModel && <button className="model-required" onClick={() => { setSettingsTab("models"); openSettings(); }}>
                    <Bot /><span><b>Connect a model to start chatting</b><small>Open Models & providers in Settings</small></span><ArrowRight />
                  </button>}
                  <div className="temporary-notice"><Clock3 /><span><b>Temporary chat</b><small>Not saved to history</small></span></div>
                  <div className={`composer ${!config.activeModel ? "locked" : ""}`}>
                    <textarea
                      dir="auto"
                      disabled={!config.activeModel}
                      value={activeBrowserTab.draft || ""}
                      rows={1}
                      placeholder={config.activeModel ? `Message ${config.branding.appName}…` : "Choose a model before sending a message"}
                      onChange={(event) => updateWorkspaceTab(activeBrowserTab.id, { draft: event.target.value })}
                      onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendTemporaryChat(); } }}
                    />
                    <div className="composer-tools">
                      <div>
                        <button disabled title="Attachments are not kept in temporary chat"><Paperclip /></button>
                        <button disabled title="Images are not kept in temporary chat"><ImageIcon /></button>
                      </div>
                      <div>
                        <button disabled title="Voice input"><Mic /></button>
                        <button
                          className={`send ${activeBrowserTab.busy ? "stop" : ""}`}
                          disabled={!activeBrowserTab.busy && (!config.activeModel || !activeBrowserTab.draft?.trim())}
                          onClick={activeBrowserTab.busy ? stopResponse : sendTemporaryChat}
                          title={activeBrowserTab.busy ? "Stop response" : "Send message"}
                        >{activeBrowserTab.busy ? <Square /> : <ArrowUp />}</button>
                      </div>
                    </div>
                  </div>
                  <p>{config.branding.appName} can make mistakes. Verify important information.</p>
                </div>
              </div>
            ) : (
              <div className="workspace-home">
                <span>YOUR AI WORKSPACE</span>
                <h2>What would you like to open?</h2>
                <p>Everything lives in one unified, focused workspace.</p>
                <div className="workspace-launchers">
                  <button onClick={addTemporaryChatTab}><Clock3 /><span><b>Temporary chat</b><small>Private session, never added to history</small></span><ArrowRight /></button>
                  <button onClick={addBrowserTab}><Globe2 /><span><b>Browser</b><small>Research without leaving Nova</small></span><ArrowRight /></button>
                  <button onClick={addFilesTab}><Folder /><span><b>{chat.workspaceId ? "Work files" : "Files"}</b><small>{chat.workspaceId ? "Inspect files in this project folder" : "Work with documents and images"}</small></span><ArrowRight /></button>
                </div>
              </div>
            )}
            </div>
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
            {!chats.find((item) => item.id === chatMenu.chatId)?.workspaceId && <>
              <div className="context-separator" />
              <small>Move to folder</small>
              {folders.map((folder) => {
                const Icon = folderIcons[folder.icon];
                return <button key={folder.id} onClick={() => moveChat(chatMenu.chatId, folder.id)}><Icon style={{ color: folder.color }} />{folder.name}</button>;
              })}
              {chats.find((item) => item.id === chatMenu.chatId)?.folderId && <button onClick={() => moveChat(chatMenu.chatId)}><X />Remove from folder</button>}
              {!folders.length && <em>Create a folder first</em>}
            </>}
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
      {workspaceDelete && (
        <div className="confirm-backdrop" onMouseDown={() => setWorkspaceDelete(null)}>
          <div className="confirm-dialog workspace-delete-dialog" onMouseDown={(event) => event.stopPropagation()}>
            <div className="confirm-icon delete"><Trash2 /></div>
            <h3>Remove workspace?</h3>
            <p><b>{workspaceDelete.name}</b> and all of its Work chats will be removed from Nova.</p>
            <div className="workspace-delete-safety"><ShieldCheck /><span><b>Your project stays untouched</b><small>{workspaceDelete.rootPath}</small></span></div>
            <div><button className="secondary" onClick={() => setWorkspaceDelete(null)}>Cancel</button><button className="confirm-delete" onClick={() => deleteWorkspace(workspaceDelete)}>Remove from Nova</button></div>
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
