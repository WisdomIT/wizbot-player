const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  globalShortcut,
  nativeImage,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const dotenv = require("dotenv");
const isDev = require("electron-is-dev");

function loadEnv() {
  const envCandidates = [
    path.join(process.cwd(), ".env"),
    path.join(__dirname, "../.env"),
  ];

  for (const candidate of envCandidates) {
    try {
      if (fs.existsSync(candidate)) {
        dotenv.config({ path: candidate });
        return;
      }
    } catch (error) {
      console.warn(`Failed to access env file at ${candidate}`, error);
    }
  }

  dotenv.config();
}

loadEnv();

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const FRONTEND_HASH = "#/";
const PLAYER_HASH = "#/player";
const LOGIN_PROTOCOL = "wizbot";
const POLL_INTERVAL_MS = Number(process.env.WIZBOT_POLL_INTERVAL ?? 10000);
const API_BASE_URL = process.env.WIZBOT_API_BASE ?? "https://api.wizbot.app";

let mainWindow;
let playerWindow;
let tray;
let isQuitting = false;
let pollTimer;

const state = {
  playlist: [],
  currentId: null,
  playbackStatus: "stopped",
  isBuffering: false,
  currentTitle: "",
  volume: 100,
};

const auth = {
  value: null,
  get filePath() {
    return path.join(app.getPath("userData"), "wizbot-auth.json");
  },
};

function loadPersistedAuth() {
  try {
    if (fs.existsSync(auth.filePath)) {
      const payload = JSON.parse(fs.readFileSync(auth.filePath, "utf8"));
      if (payload?.accessToken) {
        auth.value = payload;
      }
    }
  } catch (error) {
    console.error("Failed to load persisted auth", error);
  }
}

function persistAuth() {
  try {
    if (!auth.value) {
      if (fs.existsSync(auth.filePath)) {
        fs.unlinkSync(auth.filePath);
      }
      return;
    }
    fs.writeFileSync(auth.filePath, JSON.stringify(auth.value), "utf8");
  } catch (error) {
    console.error("Failed to persist auth", error);
  }
}

function getRendererUrl(hash) {
  if (isDev) {
    return `http://localhost:3000${hash}`;
  }

  const fileUrl = `file://${path.join(__dirname, "../build/index.html")}`;
  return `${fileUrl}${hash}`;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 680,
    minWidth: 360,
    minHeight: 520,
    title: "Wizbot Player",
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: isDev,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadURL(getRendererUrl(FRONTEND_HASH));

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    if (isDev) {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createPlayerWindow() {
  playerWindow = new BrowserWindow({
    width: 320,
    height: 180,
    show: false,
    frame: false,
    resizable: false,
    focusable: false,
    transparent: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: isDev,
      backgroundThrottling: false,
    },
  });

  playerWindow.loadURL(getRendererUrl(PLAYER_HASH));
  playerWindow.on("closed", () => {
    playerWindow = null;
  });
}

function buildTray() {
  if (tray) {
    return;
  }

  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9ZK7nHkAAAAASUVORK5CYII="
  );

  tray = new Tray(icon);
  tray.setToolTip("Wizbot Player");
  tray.on("click", () => {
    if (!mainWindow) {
      createMainWindow();
      return;
    }

    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  const trayMenu = Menu.buildFromTemplate([
    {
      label: "Play/Pause",
      click: togglePlayback,
    },
    {
      label: "Stop",
      click: stopPlayback,
    },
    {
      label: "Next",
      click: playNext,
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(trayMenu);
}

function updateTrayTooltip() {
  if (!tray) {
    return;
  }

  if (state.playbackStatus === "playing" && state.currentTitle) {
    tray.setToolTip(`Wizbot Player\n${state.currentTitle}`);
  } else {
    tray.setToolTip("Wizbot Player");
  }
}

function registerShortcuts() {
  globalShortcut.register("CommandOrControl+Shift+P", togglePlayback);
  globalShortcut.register("CommandOrControl+Shift+S", stopPlayback);
  globalShortcut.register("CommandOrControl+Shift+N", playNext);
}

function unregisterShortcuts() {
  globalShortcut.unregisterAll();
}

function broadcast(channel, payload) {
  if (mainWindow) {
    mainWindow.webContents.send(channel, payload);
  }
}

function broadcastPlaylist() {
  broadcast("playlist:update", {
    items: state.playlist,
    currentId: state.currentId,
  });
}

function broadcastPlayback() {
  broadcast("player:state", {
    status: state.playbackStatus,
    currentId: state.currentId,
    buffering: state.isBuffering,
    title: state.currentTitle,
  });
  updateTrayTooltip();
}

function sendToPlayer(channel, payload) {
  if (playerWindow) {
    playerWindow.webContents.send(channel, payload);
  }
}

function stopPlayback() {
  state.playbackStatus = "stopped";
  state.currentId = null;
  state.currentTitle = "";
  sendToPlayer("player:stop");
  broadcastPlayback();
}

function playItemById(id) {
  const nextIndex = state.playlist.findIndex((item) => item.id === id);
  if (nextIndex === -1) {
    return;
  }

  const item = state.playlist[nextIndex];
  state.currentId = item.id;
  state.currentTitle = item.title;
  state.playbackStatus = "loading";
  sendToPlayer("player:play-item", { item });
  broadcastPlayback();
}

function playNext() {
  if (!state.playlist.length) {
    stopPlayback();
    return;
  }

  if (!state.currentId) {
    playItemById(state.playlist[0].id);
    return;
  }

  const currentIndex = state.playlist.findIndex(
    (item) => item.id === state.currentId
  );
  const nextIndex = currentIndex + 1;
  if (nextIndex >= state.playlist.length) {
    stopPlayback();
    return;
  }

  playItemById(state.playlist[nextIndex].id);
}

function togglePlayback() {
  if (state.playbackStatus === "playing") {
    state.playbackStatus = "paused";
    sendToPlayer("player:pause");
  } else if (state.currentId) {
    state.playbackStatus = "playing";
    sendToPlayer("player:resume");
  } else if (state.playlist.length) {
    playItemById(state.playlist[0].id);
  }

  broadcastPlayback();
}

async function refreshPlaylist() {
  if (!auth.value?.accessToken) {
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/queue`, {
      headers: {
        Authorization: `Bearer ${auth.value.accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`API responded with status ${response.status}`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload?.items)) {
      throw new Error("Unexpected playlist payload shape");
    }

    state.playlist = payload.items.map((item) => ({
      id: String(
        item.id ??
          item.videoId ??
          item.youtubeId ??
          (crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`)
      ),
      title: item.title ?? "Untitled",
      videoId: item.videoId ?? item.youtubeId ?? item.id,
      requestedBy: item.requestedBy ?? item.user ?? null,
      duration: item.duration ?? null,
    }));

    broadcastPlaylist();
  } catch (error) {
    console.error("Failed to refresh playlist", error);
  }
}

function startPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }

  pollTimer = setInterval(() => {
    refreshPlaylist().catch((error) =>
      console.error("Unexpected playlist poll error", error)
    );
  }, POLL_INTERVAL_MS);
}

function setAuthFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${LOGIN_PROTOCOL}:`) {
      return false;
    }

    const accessToken =
      parsed.searchParams.get("token") ??
      parsed.searchParams.get("access_token");
    const refreshToken = parsed.searchParams.get("refresh_token");
    const expiresIn = parsed.searchParams.get("expires_in");
    const username = parsed.searchParams.get("username");

    if (!accessToken) {
      throw new Error("Missing access token in callback");
    }

    auth.value = {
      accessToken,
      refreshToken,
      expiresAt: expiresIn ? Date.now() + Number(expiresIn) * 1000 : null,
      username,
    };

    persistAuth();
    broadcast("auth:update", { authenticated: true, username });
    refreshPlaylist();
    return true;
  } catch (error) {
    console.error("Failed to parse auth callback", error);
    return false;
  }
}

function registerProtocolHandler() {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(LOGIN_PROTOCOL, process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient(LOGIN_PROTOCOL);
  }
}

function handleSecondInstance(event, argv) {
  if (process.platform === "win32" || process.platform === "linux") {
    const url = argv.find((value) => value.startsWith(`${LOGIN_PROTOCOL}://`));
    if (url) {
      setAuthFromUrl(url);
    }
  }

  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  }
}

function initialiseIpc() {
  ipcMain.handle("auth:open-login", () => {
    const target = process.env.WIZBOT_LOGIN_URL ?? "https://wizbot.app/login";
    shell.openExternal(target);
  });

  ipcMain.handle("state:get", () => ({
    playlist: state.playlist,
    currentId: state.currentId,
    status: state.playbackStatus,
    buffering: state.isBuffering,
    title: state.currentTitle,
    authenticated: Boolean(auth.value?.accessToken),
    username: auth.value?.username ?? null,
  }));

  ipcMain.handle("playlist:play", (_event, id) => {
    playItemById(id);
  });

  ipcMain.handle("playlist:remove", (_event, id) => {
    const index = state.playlist.findIndex((item) => item.id === id);
    if (index === -1) {
      return;
    }

    state.playlist.splice(index, 1);

    if (state.currentId === id) {
      playItemById(state.playlist[index]?.id ?? state.playlist[0]?.id ?? null);
      if (state.playlist.length === 0) {
        stopPlayback();
      }
    }

    broadcastPlaylist();
  });

  ipcMain.handle("playlist:reorder", (_event, payload) => {
    const { from, to } = payload ?? {};
    if (
      typeof from !== "number" ||
      typeof to !== "number" ||
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= state.playlist.length ||
      to >= state.playlist.length
    ) {
      return;
    }

    const [item] = state.playlist.splice(from, 1);
    state.playlist.splice(to, 0, item);
    broadcastPlaylist();
  });

  ipcMain.handle("player:toggle", () => {
    togglePlayback();
  });

  ipcMain.handle("player:stop", () => {
    stopPlayback();
  });

  ipcMain.handle("player:next", () => {
    playNext();
  });

  ipcMain.on("player:update", (_event, payload) => {
    if (payload?.status) {
      state.playbackStatus = payload.status;
    }

    if (payload?.currentId) {
      state.currentId = payload.currentId;
    }

    if (typeof payload?.buffering === "boolean") {
      state.isBuffering = payload.buffering;
    }

    if (payload?.title) {
      state.currentTitle = payload.title;
    }

    if (payload?.ended) {
      playNext();
      return;
    }

    broadcastPlayback();
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", handleSecondInstance);
}

app.on("ready", () => {
  loadPersistedAuth();
  createMainWindow();
  createPlayerWindow();
  buildTray();
  registerShortcuts();
  initialiseIpc();
  registerProtocolHandler();
  if (auth.value) {
    broadcast("auth:update", {
      authenticated: true,
      username: auth.value.username ?? null,
    });
    refreshPlaylist();
  }
  startPolling();
});

app.on("activate", () => {
  if (!mainWindow) {
    createMainWindow();
  } else {
    mainWindow.show();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("will-quit", () => {
  unregisterShortcuts();
  if (pollTimer) {
    clearInterval(pollTimer);
  }
});

app.on("window-all-closed", (event) => {
  if (process.platform !== "darwin") {
    if (!isQuitting) {
      event.preventDefault();
    }
  }
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  setAuthFromUrl(url);
});

if (process.platform === "win32") {
  const urlArg = process.argv.find((value) =>
    value.startsWith(`${LOGIN_PROTOCOL}://`)
  );
  if (urlArg) {
    setAuthFromUrl(urlArg);
  }
}
