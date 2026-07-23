import { createDefaultBottomPattern } from '../config/bottomPattern.js';

const defaults = createDefaultBottomPattern();
const presets = [{ id: 'none', label: 'No preset', assetRef: '' }, { id: 'chelsea-stripe', label: 'Chelsea stripe', assetRef: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="32" height="32"%3E%3Cpath fill="%230343a3" d="M0 0h16v32H0z"/%3E%3Cpath fill="%23fff" d="M16 0h16v32H16z"/%3E%3C/svg%3E' }];

export function BottomPatternPanel({ pattern = defaults, onChange }) {
  const transform = { ...defaults.transform, ...pattern.transform };
  const repeat = { ...defaults.transform.repeat, ...transform.repeat };

  return (
    <section aria-label="Continuous bottom pattern" className="bottom-pattern-panel">
      <label className="bottom-pattern-toggle">
        <input
          checked={Boolean(pattern.enabled)}
          onChange={(event) => onChange({ enabled: event.target.checked })}
          type="checkbox"
        />
        <span>Enable continuous bottom pattern</span>
      </label>
      <label className="bottom-pattern-control">Pattern preset
        <select aria-label="Pattern preset" onChange={(event) => { const preset = presets.find((item) => item.id === event.target.value) ?? presets[0]; onChange({ source: { kind: 'preset', id: preset.id, assetRef: preset.assetRef } }); }} value={pattern.source?.id ?? 'none'}>
          {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
        </select>
      </label>
      <PatternControl label="Pattern scale" max="8" min="0.1" onChange={(value) => onChange({ transform: { scale: value } })} step="0.1" value={transform.scale} />
      <PatternControl label="Pattern rotation" max="359" min="0" onChange={(value) => onChange({ transform: { rotationDeg: value } })} step="1" value={transform.rotationDeg} />
      <PatternControl label="Horizontal repeat" max="16" min="1" onChange={(value) => onChange({ transform: { repeat: { u: value } } })} step="1" value={repeat.u} />
      <PatternControl label="Vertical repeat" max="16" min="1" onChange={(value) => onChange({ transform: { repeat: { v: value } } })} step="1" value={repeat.v} />
      <button className="soft-button bottom-pattern-reset" onClick={() => onChange({ enabled: defaults.enabled, transform: { scale: defaults.transform.scale, rotationDeg: defaults.transform.rotationDeg, repeat: structuredClone(defaults.transform.repeat) } })} type="button">Reset controls</button>
    </section>
  );
}

function PatternControl({ label, max, min, onChange, step, value }) {
  return (
    <label className="bottom-pattern-control">
      <span>{label}<output>{value}</output></span>
      <input aria-label={label} max={max} min={min} onChange={(event) => onChange(Number(event.target.value))} step={step} type="range" value={value} />
    </label>
  );
}
