import { useState } from 'react';
import { APPEARANCE_ZONES } from '../config/appearance.js';

const zoneLabels = {
  body: 'Body',
  sleeves: 'Sleeves',
  shoulderSide: 'Shoulder & side',
  collar: 'Collar',
  pattern: 'Pattern',
  number: 'Number',
};

export function ZoneColorPanel({ colors, onColorChange, palette }) {
  const [activeZoneId, setActiveZoneId] = useState(APPEARANCE_ZONES[0]);
  const activeColor = colors[activeZoneId];

  return (
    <section aria-label="Zone colors" className="zone-color-panel">
      <div className="zone-picker">
        {APPEARANCE_ZONES.map((zoneId) => (
          <button
            aria-pressed={zoneId === activeZoneId}
            className={zoneId === activeZoneId ? 'active' : ''}
            key={zoneId}
            onClick={() => setActiveZoneId(zoneId)}
            type="button"
          >
            {zoneLabels[zoneId]}
          </button>
        ))}
      </div>
      <div className="active-zone-color">
        <i aria-hidden="true" style={{ backgroundColor: activeColor }} />
        <output aria-label="Current color">{activeColor}</output>
      </div>
      <div aria-label="Preset colors" className="color-palette">
        {palette.map((color) => (
          <button
            aria-label={`Use ${color}`}
            key={color}
            onClick={() => onColorChange({ [activeZoneId]: color })}
            style={{ backgroundColor: color }}
            type="button"
          />
        ))}
      </div>
    </section>
  );
}
