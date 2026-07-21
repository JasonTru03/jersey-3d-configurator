export function TemplateLibrary({ activeTemplate, onSelect, templates }) {
  return (
    <section aria-label="Jersey templates" className="template-library">
      {templates.map((template) => (
        <button
          aria-pressed={template.id === activeTemplate}
          className={template.id === activeTemplate ? 'template-card active' : 'template-card'}
          key={template.id}
          onClick={() => onSelect(template.id)}
          type="button"
        >
          <span
            aria-hidden="true"
            className={`template-preview template-preview--${template.id}`}
            data-testid={`template-preview-${template.id}`}
          />
          <span>{template.label}</span>
        </button>
      ))}
    </section>
  );
}
