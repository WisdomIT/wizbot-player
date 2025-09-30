import React, { useCallback, useEffect, useRef } from "react";
import { PlaybackStatus, PlaylistItem } from "../types";

type IpcRendererLike = {
  on: (channel: string, listener: (_event: unknown, payload: any) => void) => void;
  removeListener: (channel: string, listener: (_event: unknown, payload: any) => void) => void;
  send: (channel: string, payload?: unknown) => void;
};

type PlayerStateChangePayload = {
  status?: PlaybackStatus;
  currentId?: string | null;
  buffering?: boolean;
  title?: string;
  ended?: boolean;
};

type YoutubePlayer = {
  loadVideoById: (videoId: string) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  setVolume: (volume: number) => void;
  mute: () => void;
  unMute: () => void;
};

const resolveIpcRenderer = (): IpcRendererLike | null => {
  try {
    return window.require?.("electron")?.ipcRenderer ?? null;
  } catch (error) {
    console.warn("Failed to access ipcRenderer", error);
    return null;
  }
};

const ipcRenderer = resolveIpcRenderer();

const BackgroundPlayer: React.FC = () => {
  const playerRef = useRef<YoutubePlayer | null>(null);
  const currentItemRef = useRef<PlaylistItem | null>(null);
  const pendingItemRef = useRef<PlaylistItem | null>(null);
  const scriptRef = useRef<HTMLScriptElement | null>(null);


  const reportState = useCallback((payload: PlayerStateChangePayload) => {
    if (!ipcRenderer) {
      return;
    }

    ipcRenderer.send("player:update", payload);
  }, []);

  const loadItem = useCallback(
    (item: PlaylistItem) => {
      if (!playerRef.current) {
        pendingItemRef.current = item;
        return;
      }

      reportState({
        status: "loading",
        currentId: item.id,
        buffering: true,
        title: item.title,
      });

      try {
        playerRef.current.loadVideoById(item.videoId);
      } catch (error) {
        console.error("Failed to load video", error);
        reportState({ status: "stopped", currentId: item.id, buffering: false });
      }
    },
    [reportState]
  );

  const handlePlayerState = useCallback(
    (youtubeState: number) => {
      const item = currentItemRef.current;
      switch (youtubeState) {
        case 0:
          reportState({
            status: "stopped",
            currentId: item?.id ?? null,
            buffering: false,
            title: "",
            ended: true,
          });
          break;
        case 1:
          reportState({
            status: "playing",
            currentId: item?.id ?? null,
            buffering: false,
            title: item?.title ?? "",
          });
          break;
        case 2:
          reportState({
            status: "paused",
            currentId: item?.id ?? null,
            buffering: false,
            title: item?.title ?? "",
          });
          break;
        case 3:
          reportState({
            status: "loading",
            currentId: item?.id ?? null,
            buffering: true,
            title: item?.title ?? "",
          });
          break;
        default:
          break;
      }
    },
    [reportState]
  );

  useEffect(() => {
    if (!ipcRenderer) {
      return;
    }

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    scriptRef.current = script;
    document.body.appendChild(script);

    (window as any).onYouTubeIframeAPIReady = () => {
      // eslint-disable-next-line no-new
      playerRef.current = new (window as any).YT.Player("yt-background-player", {
        height: "0",
        width: "0",
        events: {
          onReady: () => {
            playerRef.current?.setVolume(100);
            playerRef.current?.unMute();
            if (pendingItemRef.current) {
              loadItem(pendingItemRef.current);
              pendingItemRef.current = null;
            }
          },
          onStateChange: (event: { data: number }) => {
            handlePlayerState(event.data);
          },
          onError: () => {
            if (currentItemRef.current) {
              const message: PlayerStateChangePayload = {
                status: "stopped",
                currentId: currentItemRef.current.id,
              };
              ipcRenderer.send("player:update", message);
            }
          },
        },
        playerVars: {
          autoplay: 1,
          controls: 0,
          modestbranding: 1,
          rel: 0,
        },
      });
    };

    return () => {
      if (scriptRef.current) {
        document.body.removeChild(scriptRef.current);
      }
      (window as any).onYouTubeIframeAPIReady = undefined;
    };
  }, [handlePlayerState, loadItem]);

  useEffect(() => {
    if (!ipcRenderer) {
      return;
    }

    const handlePlayItem = (_event: unknown, payload: { item: PlaylistItem }) => {
      const item = payload?.item;
      if (!item) {
        return;
      }

      currentItemRef.current = item;
      if (!playerRef.current) {
        pendingItemRef.current = item;
        return;
      }

      loadItem(item);
    };

    const handlePause = () => {
      playerRef.current?.pauseVideo();
      reportState({
        status: "paused",
        currentId: currentItemRef.current?.id ?? null,
        buffering: false,
        title: currentItemRef.current?.title ?? "",
      });
    };

    const handleResume = () => {
      if (!playerRef.current && currentItemRef.current) {
        pendingItemRef.current = currentItemRef.current;
        return;
      }

      playerRef.current?.playVideo();
      reportState({
        status: "playing",
        currentId: currentItemRef.current?.id ?? null,
        buffering: false,
        title: currentItemRef.current?.title ?? "",
      });
    };

    const handleStop = () => {
      playerRef.current?.stopVideo();
      reportState({
        status: "stopped",
        currentId: currentItemRef.current?.id ?? null,
        buffering: false,
        title: "",
      });
      currentItemRef.current = null;
    };

    ipcRenderer.on("player:play-item", handlePlayItem);
    ipcRenderer.on("player:pause", handlePause);
    ipcRenderer.on("player:resume", handleResume);
    ipcRenderer.on("player:stop", handleStop);

    return () => {
      ipcRenderer.removeListener("player:play-item", handlePlayItem);
      ipcRenderer.removeListener("player:pause", handlePause);
      ipcRenderer.removeListener("player:resume", handleResume);
      ipcRenderer.removeListener("player:stop", handleStop);
    };
  }, [loadItem, reportState]);

  return <div id="yt-background-player" style={{ width: 0, height: 0 }} />;
};

export default BackgroundPlayer;
