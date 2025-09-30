import React, { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import { AuthState, PlaybackStatus, PlayerStateSnapshot, PlaylistItem } from "./types";
import BackgroundPlayer from "./background/BackgroundPlayer";

type RendererApi = {
  ipcRenderer?: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    on: (channel: string, listener: (_event: unknown, payload: any) => void) => void;
    removeListener: (channel: string, listener: (_event: unknown, payload: any) => void) => void;
    send: (channel: string, payload?: unknown) => void;
  };
};

const getRendererApi = (): RendererApi => {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const electron = window.require?.("electron");
    return electron ?? {};
  } catch (error) {
    console.warn("Electron IPC is not available", error);
    return {};
  }
};

const { ipcRenderer } = getRendererApi();

const mode = () => (window.location.hash === "#/player" ? "player" : "main");

const defaultPlayerState: PlayerStateSnapshot = {
  status: "stopped",
  currentId: null,
  buffering: false,
  title: "",
};

const defaultAuth: AuthState = {
  authenticated: false,
  username: null,
};

function ForegroundApp() {
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [playerState, setPlayerState] = useState<PlayerStateSnapshot>(defaultPlayerState);
  const [authState, setAuthState] = useState<AuthState>(defaultAuth);

  useEffect(() => {
    if (!ipcRenderer) {
      return;
    }

    ipcRenderer.invoke("state:get").then((snapshot) => {
      const payload = snapshot as {
        playlist?: PlaylistItem[];
        currentId?: string | null;
        status?: PlaybackStatus;
        buffering?: boolean;
        title?: string;
        authenticated?: boolean;
        username?: string | null;
      };

      if (Array.isArray(payload.playlist)) {
        setPlaylist(payload.playlist);
      }

      setPlayerState((current) => ({
        ...current,
        status: payload.status ?? current.status,
        currentId: payload.currentId ?? current.currentId,
        buffering: payload.buffering ?? current.buffering,
        title: payload.title ?? current.title,
      }));

      setAuthState({
        authenticated: Boolean(payload.authenticated),
        username: payload.username ?? null,
      });
    });

    const handlePlaylist = (_event: unknown, payload: { items: PlaylistItem[]; currentId: string | null }) => {
      if (Array.isArray(payload?.items)) {
        setPlaylist(payload.items);
      }

      setPlayerState((prev) => ({
        ...prev,
        currentId: payload?.currentId ?? prev.currentId,
      }));
    };

    const handlePlayerState = (
      _event: unknown,
      payload: { status?: PlaybackStatus; currentId?: string | null; buffering?: boolean; title?: string }
    ) => {
      setPlayerState((prev) => ({
        status: payload.status ?? prev.status,
        currentId: payload.currentId ?? prev.currentId,
        buffering: payload.buffering ?? prev.buffering,
        title: payload.title ?? prev.title,
      }));
    };

    const handleAuthUpdate = (_event: unknown, payload: AuthState) => {
      setAuthState({
        authenticated: Boolean(payload?.authenticated),
        username: payload?.username ?? null,
      });
    };

    ipcRenderer.on("playlist:update", handlePlaylist);
    ipcRenderer.on("player:state", handlePlayerState);
    ipcRenderer.on("auth:update", handleAuthUpdate);

    return () => {
      ipcRenderer.removeListener("playlist:update", handlePlaylist);
      ipcRenderer.removeListener("player:state", handlePlayerState);
      ipcRenderer.removeListener("auth:update", handleAuthUpdate);
    };
  }, []);

  const playbackLabel = useMemo(() => {
    switch (playerState.status) {
      case "playing":
        return authState.authenticated ? "재생 중" : "재생 중 (로그인 필요)";
      case "paused":
        return "일시 정지";
      case "loading":
        return "불러오는 중";
      default:
        return "대기";
    }
  }, [playerState.status, authState.authenticated]);

  const currentTitleLabel = useMemo(() => {
    if (playerState.status === "stopped" || !playerState.title) {
      return "";
    }

    return playerState.title;
  }, [playerState]);

  const invoke = useCallback(
    (channel: string, payload?: unknown) => {
      if (!ipcRenderer) {
        return;
      }

      ipcRenderer.invoke(channel, payload);
    },
    []
  );

  const handlePlay = useCallback(
    (id: string) => {
      invoke("playlist:play", id);
    },
    [invoke]
  );

  const handleRemove = useCallback(
    (id: string) => {
      invoke("playlist:remove", id);
    },
    [invoke]
  );

  const handleMove = useCallback(
    (from: number, to: number) => {
      if (from === to || from < 0 || to < 0 || from >= playlist.length || to >= playlist.length) {
        return;
      }

      setPlaylist((current) => {
        const copy = current.slice();
        const [item] = copy.splice(from, 1);
        copy.splice(to, 0, item);
        return copy;
      });

      invoke("playlist:reorder", { from, to });
    },
    [playlist.length, invoke]
  );

  const handleToggle = useCallback(() => invoke("player:toggle"), [invoke]);
  const handleStop = useCallback(() => invoke("player:stop"), [invoke]);
  const handleNext = useCallback(() => invoke("player:next"), [invoke]);
  const handleLogin = useCallback(() => invoke("auth:open-login"), [invoke]);

  const isPlaying = playerState.status === "playing";

  return (
    <div className="App">
      <header className="AppHeader">
        <div>
          <h1 className="AppTitle">Wizbot Player</h1>
          <p className="AppSubtitle">실시간 유튜브 신청곡 관리</p>
        </div>
        <div className="AuthBlock">
          <span className={`AuthStatus ${authState.authenticated ? "is-auth" : "is-guest"}`}>
            {authState.authenticated ? (
              <>
                로그인됨
                {authState.username ? ` · ${authState.username}` : null}
              </>
            ) : (
              "로그인되지 않음"
            )}
          </span>
          <button className="PrimaryButton" onClick={handleLogin}>
            외부 브라우저 로그인
          </button>
        </div>
      </header>

      <section className="NowPlaying">
        <div className="NowPlayingStatus">
          상태: <strong>{playbackLabel}</strong>
          {playerState.buffering ? <span className="Buffering"> · 버퍼링</span> : null}
        </div>
        {currentTitleLabel ? <div className="NowPlayingTitle">{currentTitleLabel}</div> : <div className="NowPlayingTitle">대기 중</div>}
        <div className="PlaybackControls">
          <button onClick={handleToggle} className="PrimaryButton">
            {isPlaying ? "일시 정지" : "재생"}
          </button>
          <button onClick={handleStop}>정지</button>
          <button onClick={handleNext}>다음 곡</button>
        </div>
      </section>

      <section className="PlaylistSection">
        <header className="SectionHeader">
          <h2>재생목록</h2>
          <span className="QueueCount">{playlist.length}개</span>
        </header>
        {playlist.length === 0 ? (
          <div className="EmptyState">
            현재 재생 대기 중인 영상이 없습니다. 시청자가 신청하면 자동으로 표시됩니다.
          </div>
        ) : (
          <div className="PlaylistList">
            {playlist.map((item, index) => {
              const isActive = item.id === playerState.currentId;
              return (
                <div key={item.id} className={`PlaylistItem ${isActive ? "is-active" : ""}`}>
                  <div className="ItemMain">
                    <div className="ItemTitle">{item.title}</div>
                    {item.requestedBy ? (
                      <div className="ItemMeta">신청자: {item.requestedBy}</div>
                    ) : null}
                    {item.duration ? (
                      <div className="ItemMeta">길이: {Math.round(item.duration / 60)}분</div>
                    ) : null}
                  </div>
                  <div className="ItemActions">
                    <button onClick={() => handleMove(index, index - 1)} disabled={index === 0}>
                      ↑
                    </button>
                    <button
                      onClick={() => handleMove(index, index + 1)}
                      disabled={index === playlist.length - 1}
                    >
                      ↓
                    </button>
                    <button onClick={() => handlePlay(item.id)} disabled={isActive && isPlaying}>
                      재생
                    </button>
                    <button onClick={() => handleRemove(item.id)}>삭제</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function App() {
  return mode() === "player" ? <BackgroundPlayer /> : <ForegroundApp />;
}

export default App;
