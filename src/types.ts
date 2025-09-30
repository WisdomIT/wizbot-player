export type PlaybackStatus = "stopped" | "playing" | "paused" | "loading";

export interface PlaylistItem {
  id: string;
  title: string;
  videoId: string;
  requestedBy?: string | null;
  duration?: number | null;
}

export interface PlayerStateSnapshot {
  status: PlaybackStatus;
  currentId: string | null;
  buffering: boolean;
  title: string;
}

export interface AuthState {
  authenticated: boolean;
  username: string | null;
}
