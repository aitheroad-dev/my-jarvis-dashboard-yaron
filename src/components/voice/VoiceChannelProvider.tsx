import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/lib/workos-shim";
import { useApi } from "@/lib/api";

export type VoiceSample = {
  id: string;
  agent_name: string | null;
  text_content: string;
  audio_url: string;
  title: string | null;
  duration_seconds: number | null;
  category: string | null;
  voice_id: string | null;
  created_at: string;
};

export type UserSettings = {
  voice_autoplay?: boolean;
};

const DEFAULT_SETTINGS: Required<UserSettings> = {
  voice_autoplay: false,
};

type SampleListener = (sample: VoiceSample) => void;

interface VoiceChannelContextValue {
  samples: VoiceSample[];
  connected: boolean;
  settings: UserSettings;
  updateSettings: (patch: UserSettings) => Promise<void>;
  onSampleArrived: (cb: SampleListener) => () => void;
}

const VoiceChannelContext = createContext<VoiceChannelContextValue | null>(null);

export function useVoiceChannel(): VoiceChannelContextValue {
  const ctx = useContext(VoiceChannelContext);
  if (!ctx) throw new Error("useVoiceChannel must be used inside VoiceChannelProvider");
  return ctx;
}

// Keepalive every 25s fights idle-timeouts on intermediaries (browser,
// proxies, CF edge). The DO's WS handler ignores unknown-type frames so
// client->server pings are safely dropped there.
const PING_INTERVAL_MS = 25_000;
// Initial reconnect delay. Doubles up to MAX on each failure; resets on
// successful open. Fast enough for transient drops, slow enough not to
// storm the edge when the whole endpoint is down.
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export function VoiceChannelProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const { getAccessToken } = useAuth();
  const [samples, setSamples] = useState<VoiceSample[]>([]);
  const [connected, setConnected] = useState(false);
  const [settings, setSettings] = useState<UserSettings>({});

  const wsRef = useRef<WebSocket | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const listenersRef = useRef<Set<SampleListener>>(new Set());
  const destroyedRef = useRef(false);

  // Initial feed + settings fetch. WS subscribes separately and stays
  // alive for the life of the authed session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [feedRes, settingsRes] = await Promise.all([
          api("/api/voice/feed"),
          api("/api/settings"),
        ]);
        if (!cancelled && feedRes.ok) {
          const rows = (await feedRes.json()) as VoiceSample[];
          setSamples(rows);
        }
        if (!cancelled && settingsRes.ok) {
          const body = (await settingsRes.json()) as { data?: UserSettings };
          setSettings(body.data ?? {});
        }
      } catch {
        // Transient fetch failures don't block the WS path.
      }
    })();
    return () => {
      cancelled = true;
    };
    // api closure is recreated per render; depending on it would refetch
    // on every App re-render. Stable under normal AuthKit usage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    destroyedRef.current = false;

    const clearPing = () => {
      if (pingTimerRef.current !== null) {
        window.clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
    };

    const clearReconnect = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (destroyedRef.current) return;
      clearReconnect();
      const delay = backoffRef.current;
      reconnectTimerRef.current = window.setTimeout(() => {
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (destroyedRef.current) return;
      try {
        const token = await getAccessToken();
        if (!token || destroyedRef.current) return;
        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const url = `${proto}//${window.location.host}/api/voice/stream?token=${encodeURIComponent(token)}`;
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.addEventListener("open", () => {
          backoffRef.current = INITIAL_BACKOFF_MS;
          setConnected(true);
          clearPing();
          pingTimerRef.current = window.setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(JSON.stringify({ type: "ping" }));
              } catch {
                // Send can throw on half-closed sockets; ignore.
              }
            }
          }, PING_INTERVAL_MS);
        });

        ws.addEventListener("message", (ev) => {
          try {
            const frame = JSON.parse(ev.data);
            if (frame && frame.type === "sample" && frame.data) {
              const sample = frame.data as VoiceSample;
              setSamples((prev) => {
                if (prev.some((s) => s.id === sample.id)) return prev;
                return [sample, ...prev];
              });
              listenersRef.current.forEach((fn) => {
                try {
                  fn(sample);
                } catch {
                  // Isolate listener failures from the others.
                }
              });
            } else if (frame && frame.type === "deploy") {
              // New deployment broadcast. Reload immediately — voice samples
              // are persisted in the feed so anything mid-playback can be
              // replayed after reload. This is the fast path; useVersionPoll
              // is the fallback for tabs that lost the WS.
              window.location.reload();
            }
          } catch {
            // Non-JSON or unknown frame — drop.
          }
        });

        const handleClose = () => {
          setConnected(false);
          clearPing();
          if (destroyedRef.current) return;
          scheduleReconnect();
        };
        ws.addEventListener("close", handleClose);
        ws.addEventListener("error", () => {
          try {
            ws.close();
          } catch {
            // close() can throw if already closed; ignore.
          }
        });
      } catch {
        scheduleReconnect();
      }
    };

    const onVisibility = () => {
      if (
        document.visibilityState === "visible" &&
        (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED)
      ) {
        clearReconnect();
        backoffRef.current = INITIAL_BACKOFF_MS;
        void connect();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    void connect();

    return () => {
      destroyedRef.current = true;
      document.removeEventListener("visibilitychange", onVisibility);
      clearPing();
      clearReconnect();
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }
    };
    // getAccessToken is stable from AuthKit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSettings = useCallback(
    async (patch: UserSettings) => {
      setSettings((prev) => ({ ...prev, ...patch }));
      try {
        const res = await api("/api/settings", {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
        if (res.ok) {
          const body = (await res.json()) as { data?: UserSettings };
          if (body.data) setSettings(body.data);
        }
      } catch {
        // Optimistic value already applied.
      }
    },
    [api],
  );

  const onSampleArrived = useCallback((cb: SampleListener) => {
    listenersRef.current.add(cb);
    return () => {
      listenersRef.current.delete(cb);
    };
  }, []);

  const value = useMemo<VoiceChannelContextValue>(
    () => ({
      samples,
      connected,
      settings: { ...DEFAULT_SETTINGS, ...settings },
      updateSettings,
      onSampleArrived,
    }),
    [samples, connected, settings, updateSettings, onSampleArrived],
  );

  return <VoiceChannelContext.Provider value={value}>{children}</VoiceChannelContext.Provider>;
}
