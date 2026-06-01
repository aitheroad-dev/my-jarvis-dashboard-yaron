import { useEffect, useRef } from "react";
import { audioManager } from "./audioManager";
import { useVoiceChannel, type VoiceSample } from "./VoiceChannelProvider";
import { isPlayed, markPlayed } from "./playedStore";

/**
 * App-level continuous-playback coordinator — mirrors a podcast / the local
 * pai-voice player. Two behaviours, both gated by the voice_autoplay toggle:
 *
 *  1. New arrival → if nothing is playing and it's unheard, play it.
 *  2. Any clip ends (whether it auto-played OR the user clicked play on it) →
 *     advance to the next UNHEARD clip in chronological order. So if you press
 *     play on an older message, when it finishes you keep hearing forward
 *     through everything newer that you haven't heard yet, then it stops.
 *
 * "Heard" is the shared playedStore (localStorage), written by both this
 * manager and VoicePlayerInline, so manual and auto playback never replay each
 * other. Never interrupts a clip mid-play — new arrivals are picked up when the
 * current one ends.
 *
 * Renders nothing — purely a listener.
 */
export function AutoplayManager() {
  const { samples, settings, onSampleArrived } = useVoiceChannel();
  const autoplayEnabled = !!settings.voice_autoplay;

  // Refs so the long-lived audio subscriptions always see current state.
  const samplesRef = useRef<VoiceSample[]>(samples);
  samplesRef.current = samples;
  const enabledRef = useRef(autoplayEnabled);
  enabledRef.current = autoplayEnabled;

  useEffect(() => {
    // All clips that have audio, oldest → newest.
    const ordered = (): VoiceSample[] =>
      samplesRef.current
        .filter((s) => !!s.audio_url)
        .slice()
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );

    // The sample whose audio_url matches the audio element's current src
    // (src is absolute, audio_url is the relative /api/voice/clip/<id> path).
    const sampleForSrc = (src: string): VoiceSample | undefined => {
      if (!src) return undefined;
      return samplesRef.current.find(
        (s) => !!s.audio_url && (src.endsWith(s.audio_url) || src === s.audio_url),
      );
    };

    // Oldest unheard clip strictly newer than `t`.
    const nextUnheardAfter = (t: number): VoiceSample | undefined =>
      ordered().find(
        (s) =>
          new Date(s.created_at).getTime() > t &&
          !!s.audio_url &&
          !isPlayed(s.audio_url),
      );

    const unsubEnded = audioManager.onEnded(() => {
      const finished = sampleForSrc(audioManager.getCurrentSrc());
      if (finished?.audio_url) markPlayed(finished.audio_url);
      if (!enabledRef.current) return;
      const t = finished ? new Date(finished.created_at).getTime() : 0;
      const next = nextUnheardAfter(t);
      if (next?.audio_url) audioManager.play(next.audio_url);
    });

    const unsubSample = onSampleArrived((sample) => {
      if (!enabledRef.current) return;
      if (!sample.audio_url) return;
      if (isPlayed(sample.audio_url)) return;
      // Don't interrupt — when the current clip ends, the ended handler chains
      // forward and will reach this newer arrival in order.
      if (audioManager.isBusy()) return;
      audioManager.play(sample.audio_url);
    });

    return () => {
      unsubEnded();
      unsubSample();
    };
  }, [onSampleArrived]);

  return null;
}
