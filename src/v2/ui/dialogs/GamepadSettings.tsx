import React from 'react';
import { STRINGS } from '../strings';
import { COMMANDS, type CommandId } from '../commands/registry';
import { DEFAULT_GAMEPAD, GAMEPAD_SLOTS, GAMEPAD_SLOT_LABELS, withGamepadCommand, type GamepadProfile, type GamepadSlot } from '../commands/gamepad';

interface GamepadSettingsProps {
  profile: GamepadProfile;
  onChange: (next: GamepadProfile) => void;
  /** The controller the browser sees now, or null. */
  controllerName: string | null;
  /** The last slot pressed on it, so each button can be checked here. */
  lastSlot: GamepadSlot | null;
}

const buttonClass = 'min-h-9 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2.5 text-xs text-[var(--text-primary)] disabled:opacity-40';

/** Settings > Keyboard > Game controller: what each button and stick direction does. Shown once the switch is on. */
export default function GamepadSettings({ profile, onChange, controllerName, lastSlot }: GamepadSettingsProps) {
  const labelOf = (id: CommandId) => COMMANDS.find((command) => command.id === id)?.label ?? id;
  const lastCommand = lastSlot ? profile[lastSlot] : null;
  return (
    <div className="space-y-2" data-testid="gamepad-settings">
      <p className="text-xs text-[var(--text-secondary)]">{STRINGS.keyboardKeys.gamepadHelp}</p>
      <p aria-live="polite" data-testid="gamepad-status" className="text-xs text-[var(--text-secondary)]">
        {controllerName ? STRINGS.keyboardKeys.gamepadConnected(controllerName) : STRINGS.keyboardKeys.gamepadNone}
        {lastSlot && <><br />{lastCommand ? STRINGS.keyboardKeys.gamepadLast(GAMEPAD_SLOT_LABELS[lastSlot], labelOf(lastCommand)) : STRINGS.keyboardKeys.gamepadLastNothing(GAMEPAD_SLOT_LABELS[lastSlot])}</>}
      </p>
      <div className="divide-y divide-[var(--border-subtle)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)]">
        {GAMEPAD_SLOTS.map((slot) => (
          <div key={slot} className={`flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 text-xs ${lastSlot === slot ? 'outline outline-2 outline-[var(--brand-accent)]' : ''}`}>
            <span className="text-[var(--text-primary)]">
              {GAMEPAD_SLOT_LABELS[slot]}
            </span>
            <select
              aria-label={STRINGS.keyboardKeys.actionLabel(GAMEPAD_SLOT_LABELS[slot])}
              value={profile[slot] ?? ''}
              onChange={(e) => onChange(withGamepadCommand(profile, slot, (e.target.value || null) as CommandId | null))}
              className="h-9 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 text-xs text-[var(--text-primary)]"
            >
              <option value="">{STRINGS.keyboardKeys.nothing}</option>
              {COMMANDS.map((command) => <option key={command.id} value={command.id}>{command.label}</option>)}
            </select>
          </div>
        ))}
      </div>
      <button type="button" className={buttonClass} onClick={() => onChange(DEFAULT_GAMEPAD)}>{STRINGS.keyboardKeys.gamepadReset}</button>
    </div>
  );
}
