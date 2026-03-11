export const COLORS = {
  bg:           '#1e1e2e',
  bgDark:       '#181825',
  bgLight:      '#313244',
  bgPanel:      '#1e1e2eee',
  surface:      '#2a2a3c',
  surfaceHover: '#353548',
  border:       '#45475a',
  borderLight:  '#585b70',
  text:         '#cdd6f4',
  textDim:      '#a6adc8',
  textMuted:    '#6c7086',
  accent:       '#89b4fa',
  accentDim:    '#74c7ec',
  success:      '#a6e3a1',
  warning:      '#f9e2af',
  error:        '#f38ba8',
  red:          '#f38ba8',
  green:        '#a6e3a1',
  blue:         '#89b4fa',
  yellow:       '#f9e2af',
  purple:       '#cba6f7',
  teal:         '#94e2d5',
  gizmoX:       '#ef4444',
  gizmoY:       '#22c55e',
  gizmoZ:       '#3b82f6',
  gizmoHover:   '#fbbf24',
  selection:    'rgba(137,180,250,0.25)',
  selectionBorder: '#89b4fa',
} as const;

export const FONT = {
  mono: 'Consolas, "Fira Code", "JetBrains Mono", monospace',
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  size: {
    xs: '10px',
    sm: '11px',
    md: '12px',
    lg: '13px',
    xl: '14px',
  },
} as const;

export const SIZES = {
  menuBarHeight: 28,
  toolbarHeight: 36,
  statusBarHeight: 24,
  panelMinWidth: 200,
  panelDefaultWidth: 280,
  scrollbar: 6,
} as const;

export function injectEditorStyles(): void {
  if (document.getElementById('horizon-editor-styles')) return;
  const style = document.createElement('style');
  style.id = 'horizon-editor-styles';
  style.textContent = `
    .he-root * { box-sizing: border-box; margin: 0; padding: 0; }
    .he-root { font-family: ${FONT.sans}; font-size: ${FONT.size.md}; color: ${COLORS.text}; }
    .he-root ::-webkit-scrollbar { width: ${SIZES.scrollbar}px; height: ${SIZES.scrollbar}px; }
    .he-root ::-webkit-scrollbar-track { background: transparent; }
    .he-root ::-webkit-scrollbar-thumb { background: ${COLORS.borderLight}; border-radius: 3px; }
    .he-root ::-webkit-scrollbar-thumb:hover { background: ${COLORS.textMuted}; }
    .he-root input, .he-root select, .he-root button {
      font-family: ${FONT.sans}; font-size: ${FONT.size.sm};
      outline: none; border: 1px solid ${COLORS.border};
      background: ${COLORS.bgDark}; color: ${COLORS.text};
      border-radius: 3px; padding: 2px 6px;
    }
    .he-root input:focus, .he-root select:focus {
      border-color: ${COLORS.accent};
    }
    .he-root button {
      cursor: pointer; padding: 3px 8px; background: ${COLORS.surface};
      transition: background 0.1s;
    }
    .he-root button:hover { background: ${COLORS.surfaceHover}; }
    .he-root button:active { background: ${COLORS.accent}; color: ${COLORS.bgDark}; }
    .he-root button.active { background: ${COLORS.accent}; color: ${COLORS.bgDark}; font-weight: 600; }
  `;
  document.head.appendChild(style);
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  styles?: Partial<CSSStyleDeclaration>,
  attrs?: Record<string, string>,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (styles) Object.assign(e.style, styles);
  if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
