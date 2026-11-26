import { useEffect, useRef } from 'react';
import { EMPTY_GAMEPAD_STATE, firstGamepad, stepGamepad, type GamepadFire, type GamepadProfile, type GamepadState } from './gamepad';

interface UseGamepadOptions {
  /** Settings > Keyboard > Game controller. Off by default; when off nothing is read and nothing polls. */
  enabled: boolean;
  profile: GamepadProfile;
  /** Runs one press or repeat. Called only for slots that have a command. */
  onFire: (fire: GamepadFire) => void;
  /** The first press of any slot, mapped or not, and the controller's name, so Settings can show what arrived. */
  onInput?: (fire: GamepadFire, controllerName: string) => void;
  /** Connected or not, and the controller's name as the browser gives it. */
  onConnection?: (controllerName: string | null) => void;
}

/**
 * Reads the first game controller through the browser's Gamepad API, once a frame, only while one is connected and the
 * page is visible. Browsers list a controller only after a button is pressed on it, so the loop starts on
 * `gamepadconnected` (or straight away if one is already listed) and stops when it goes.
 */
export function useGamepad({ enabled, profile, onFire, onInput, onConnection }: UseGamepadOptions): void {
  const latest = useRef({ profile, onFire, onInput, onConnection });
  latest.current = { profile, onFire, onInput, onConnection };

  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return;
    let frame = 0;
    let state: GamepadState = EMPTY_GAMEPAD_STATE;
    let name: string | null = null;

    const read = () => { try { return firstGamepad(navigator.getGamepads()); } catch { return null; } };

    const poll = () => {
      frame = 0;
      const pad = read();
      if (!pad) {
        state = EMPTY_GAMEPAD_STATE;
        if (name !== null) { name = null; latest.current.onConnection?.(null); }
        return; // waits for the next gamepadconnected
      }
      if (pad.id !== name) { name = pad.id; latest.current.onConnection?.(name); }
      if (typeof document === 'undefined' || !document.hidden) {
        const result = stepGamepad(state, pad, performance.now(), latest.current.profile);
        state = result.state;
        for (const fire of result.fired) {
          if (fire.first) latest.current.onInput?.(fire, pad.id);
          if (fire.command) latest.current.onFire(fire);
        }
      } else {
        state = EMPTY_GAMEPAD_STATE; // nothing held carries over a hidden tab
      }
      frame = requestAnimationFrame(poll);
    };
    const start = () => { if (!frame) frame = requestAnimationFrame(poll); };

    window.addEventListener('gamepadconnected', start);
    window.addEventListener('gamepaddisconnected', start);
    if (read()) start();
    return () => {
      window.removeEventListener('gamepadconnected', start);
      window.removeEventListener('gamepaddisconnected', start);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (name !== null) latest.current.onConnection?.(null);
    };
  }, [enabled]);
}
