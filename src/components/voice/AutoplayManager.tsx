import { useEffect, useRef } from "react";
import { audioManager } from "./audioManager";
import { useVoiceChannel } from "./VoiceChannelProvider";

/**
 * App-level autoplay dispatcher — mirrors the local pai-voice player's logic:
 * a sequential FIFO queue. New arrivals are ENQUEUED, played one at a time,
 * and the next only starts when the current clip ends. It never interrupts a
 * clip that's already playing (the old behaviour cut off the current clip on
 * every arrival, and a 5s poll returning several at once dropped all but the
 * newest). Arrivals are delivered oldest-first by the channel, so the queue
 * plays in the order the agent spoke.
 *
 * Renders nothing — it's purely a listener component.
 */
export function AutoplayManager() {
  const { settings, onSampleArrived } = useVoiceChannel();
  const autoplayEnabled = !!settings.voice_autoplay;

  // Refs so the long-lived audio subscription always sees current state.
  const queueRef = useRef<string[]>([]);
  const activeRef = useRef<string | null>(null);
  const enabledRef = useRef(autoplayEnabled);
  enabledRef.current = autoplayEnabled;

  useEffect(() => {
    function playNext() {
      if (!enabledRef.current) return;
      if (activeRef.current) return; // a queued clip is already playing
      if (audioManager.isBusy()) return; // something else (manual play) holds the audio
      const next = queueRef.current.shift();
      if (!next) return;
      activeRef.current = next;
      audioManager.play(next);
    }

    const unsubSample = onSampleArrived((sample) => {
      if (!enabledRef.current) return;
      if (!sample.audio_url) return;
      queueRef.current.push(sample.audio_url);
      playNext();
    });

    const unsubEnded = audioManager.onEnded(() => {
      // Whatever just finished, the queue's active slot is now free.
      activeRef.current = null;
      playNext();
    });

    return () => {
      unsubSample();
      unsubEnded();
    };
  }, [onSampleArrived]);

  // When autoplay is switched off, abandon anything still queued (the current
  // clip plays out). Switching on lets the next arrival start the queue again.
  useEffect(() => {
    if (!autoplayEnabled) {
      queueRef.current = [];
      activeRef.current = null;
    }
  }, [autoplayEnabled]);

  return null;
}
