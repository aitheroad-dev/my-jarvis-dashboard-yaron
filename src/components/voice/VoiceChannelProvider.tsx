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
import { useApi } from "@/lib/api";

export type VoiceSample = {
  id: string;
  agent_name: string | null;
  text_content: string;
  audio_url: string | null;
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
  // On by default — mirrors the always-on local pai-voice player. The user can
  // still flip it off via the toggle (persisted in /api/settings).
  voice_autoplay: true,
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

const POLL_INTERVAL_MS = 5_000;

export function VoiceChannelProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [samples, setSamples] = useState<VoiceSample[]>([]);
  const [connected, setConnected] = useState(false);
  const [settings, setSettings] = useState<UserSettings>({});

  const listenersRef = useRef<Set<SampleListener>>(new Set());
  const knownIdsRef = useRef<Set<string>>(new Set());
  const pollTimerRef = useRef<number | null>(null);
  const destroyedRef = useRef(false);

  const fetchFeed = useCallback(async () => {
    try {
      const res = await api("/api/voice/feed");
      if (!res.ok) {
        setConnected(false);
        return;
      }
      const rows = (await res.json()) as VoiceSample[];
      setConnected(true);
      const newOnes: VoiceSample[] = [];
      for (const s of rows) {
        if (!knownIdsRef.current.has(s.id)) {
          knownIdsRef.current.add(s.id);
          newOnes.push(s);
        }
      }
      if (newOnes.length > 0) {
        setSamples(rows);
        // Fire listeners for genuinely new samples (skip on first load —
        // every row is "new" at mount, but we don't want to spam autoplay).
        // rows are newest-first, so reverse to deliver oldest-first — the
        // autoplay queue then plays in the order the agent actually spoke.
        if (knownIdsRef.current.size > newOnes.length) {
          [...newOnes].reverse().forEach((s) => {
            listenersRef.current.forEach((fn) => {
              try { fn(s); } catch { /* isolate listener errors */ }
            });
          });
        }
      } else if (samples.length === 0 && rows.length === 0) {
        setSamples([]);
      }
    } catch {
      setConnected(false);
    }
  }, [api, samples.length]);

  useEffect(() => {
    let cancelled = false;
    destroyedRef.current = false;

    (async () => {
      try {
        const settingsRes = await api("/api/settings");
        if (!cancelled && settingsRes.ok) {
          const body = (await settingsRes.json()) as { data?: UserSettings };
          setSettings(body.data ?? {});
        }
      } catch {
        // ignore
      }
    })();

    void fetchFeed();
    pollTimerRef.current = window.setInterval(() => {
      // Skip polling while the tab is hidden — a 5s feed poll on a background
      // tab is the same unbounded-egress pattern that blew the Neon cap.
      if (!destroyedRef.current && !document.hidden) void fetchFeed();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      destroyedRef.current = true;
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
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
