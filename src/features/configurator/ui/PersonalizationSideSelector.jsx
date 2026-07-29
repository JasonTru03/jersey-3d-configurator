import { PERSONALIZATION_SIDES } from '../config/personalizationSides.js';

export function PersonalizationSideSelector({ disabled = false, onSelect, side }) {
  return (
    <fieldset>
      <legend>Side</legend>
      <div className="font-options">
        {PERSONALIZATION_SIDES.map((option) => (
          <button
            aria-pressed={side === option.id}
            disabled={disabled}
            key={option.id}
            onClick={() => onSelect(option.id)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
