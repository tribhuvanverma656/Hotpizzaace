'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';

/**
 * New-order chime for staff screens. The sound is synthesised with Web Audio, so there is no
 * audio file to load. Browsers only allow sound after a tap on the page, so the chime unlocks
 * on the first tap or key press, and the toggle shows when a tap is still needed.
 */
const PREFERENCE_KEY = 'hpa-order-sound:v1';

let context: AudioContext | null = null;
function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Constructor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) return null;
  context ??= new Constructor();
  return context;
}

/** Two rising tones, played twice: distinct from phone and browser notification sounds. */
export function playOrderChime(): boolean {
  const audio = audioContext();
  if (!audio || audio.state !== 'running') return false;
  const start = audio.currentTime + 0.02;
  [0, 0.7].forEach((offset) =>
    [
      [880, 0],
      [1320, 0.18],
    ].forEach(([frequency, delay]) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      const at = start + offset + delay;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.6, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.32);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.34);
    }),
  );
  return true;
}

function readPreference(): boolean {
  try {
    return window.localStorage.getItem(PREFERENCE_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Ids that are new compared with what this screen has already seen. Pure for testing. */
export function newOrderIds(seen: ReadonlySet<string>, current: readonly string[]): string[] {
  return current.filter((id) => !seen.has(id));
}

/**
 * Chimes when `ids` gains an id this screen has not seen. Pass `null` while the list is not
 * loaded yet; the first loaded list is only remembered, so opening a screen is silent.
 */
export function useOrderChime(ids: readonly string[] | null, repeatUntilAccepted = false) {
  const [soundOn, setSoundOn] = useState(true);
  const [needsTap, setNeedsTap] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const soundOnRef = useRef(true);

  useEffect(() => {
    const preference = readPreference();
    soundOnRef.current = preference;
    setSoundOn(preference);
    const refresh = () => setNeedsTap(audioContext()?.state !== 'running');
    const unlock = () => {
      const audio = audioContext();
      if (audio && audio.state !== 'running') void audio.resume().then(refresh, refresh);
      else refresh();
    };
    refresh();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const key = ids ? [...ids].sort().join('|') : null;
  useEffect(() => {
    if (key === null) {
      // Not loaded (or the screen was reset): the next loaded list is remembered silently.
      seen.current = null;
      return;
    }
    const current = key ? key.split('|') : [];
    if (!seen.current) {
      seen.current = new Set(current);
      return;
    }
    const fresh = newOrderIds(seen.current, current);
    current.forEach((id) => seen.current!.add(id));
    if (!repeatUntilAccepted && fresh.length && soundOnRef.current && !playOrderChime())
      setNeedsTap(true);
  }, [key, repeatUntilAccepted]);

  useEffect(() => {
    if (!repeatUntilAccepted || !key || !soundOn) return;
    const ring = () => {
      if (!playOrderChime()) setNeedsTap(true);
    };
    ring();
    const timer = window.setInterval(ring, 5000);
    return () => window.clearInterval(timer);
  }, [key, repeatUntilAccepted, soundOn]);

  const toggle = useCallback(() => {
    const next = needsTap || !soundOnRef.current;
    soundOnRef.current = next;
    setSoundOn(next);
    try {
      window.localStorage.setItem(PREFERENCE_KEY, next ? 'on' : 'off');
    } catch {
      /* The choice still applies to this page. */
    }
    if (next) {
      const audio = audioContext();
      // The toggle tap itself unlocks audio, so play a sample to confirm the volume.
      void audio
        ?.resume()
        .then(() => {
          playOrderChime();
          setNeedsTap(false);
        })
        .catch(() => setNeedsTap(true));
    }
  }, [needsTap]);

  return { soundOn, needsTap, toggle };
}

export function OrderSoundToggle({
  soundOn,
  needsTap,
  onToggle,
  className = 'btn btn-outline',
}: {
  soundOn: boolean;
  needsTap: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={onToggle}
      aria-pressed={soundOn}
      title={
        soundOn
          ? 'New-order sound is on. Click to turn it off.'
          : 'New-order sound is off. Click to turn it on.'
      }
    >
      {soundOn ? <Bell size={18} aria-hidden="true" /> : <BellOff size={18} aria-hidden="true" />}
      {soundOn ? (needsTap ? 'Tap to enable sound' : 'Sound on') : 'Sound off'}
    </button>
  );
}
