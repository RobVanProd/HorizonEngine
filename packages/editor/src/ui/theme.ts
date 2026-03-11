export const COLORS = {
  bg:           '#0d111b',
  bgDark:       '#090d16',
  bgLight:      '#171d2b',
  bgPanel:      '#111827ee',
  surface:      '#1a2233',
  surfaceHover: '#242f46',
  border:       '#2b3550',
  borderLight:  '#3e4a6c',
  text:         '#e6ecff',
  textDim:      '#aeb9d8',
  textMuted:    '#6f7d9d',
  accent:       '#7c8cff',
  accentDim:    '#63d4ff',
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
  selection:    'rgba(124,140,255,0.18)',
  selectionBorder: '#7c8cff',
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
  menuBarHeight: 30,
  toolbarHeight: 40,
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
    .he-root {
      font-family: ${FONT.sans};
      font-size: ${FONT.size.md};
      color: ${COLORS.text};
      letter-spacing: 0.01em;
      background: radial-gradient(circle at top, rgba(99,212,255,0.04), transparent 35%), ${COLORS.bg};
    }
    .he-root ::-webkit-scrollbar { width: ${SIZES.scrollbar}px; height: ${SIZES.scrollbar}px; }
    .he-root ::-webkit-scrollbar-track { background: transparent; }
    .he-root ::-webkit-scrollbar-thumb { background: ${COLORS.borderLight}; border-radius: 6px; }
    .he-root ::-webkit-scrollbar-thumb:hover { background: ${COLORS.textMuted}; }
    .he-root input, .he-root select, .he-root button {
      font-family: ${FONT.sans}; font-size: ${FONT.size.sm};
      outline: none; border: 1px solid ${COLORS.border};
      background: ${COLORS.bgDark}; color: ${COLORS.text};
      border-radius: 6px; padding: 3px 8px;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.02);
    }
    .he-root input:focus, .he-root select:focus {
      border-color: ${COLORS.accent};
      box-shadow: 0 0 0 1px rgba(124,140,255,0.18);
    }
    .he-root button {
      cursor: pointer; padding: 3px 8px; background: linear-gradient(180deg, ${COLORS.surfaceHover}, ${COLORS.surface});
      transition: background 0.12s, border-color 0.12s, transform 0.08s;
    }
    .he-root button:hover { background: linear-gradient(180deg, ${COLORS.surfaceHover}, ${COLORS.bgLight}); border-color: ${COLORS.borderLight}; }
    .he-root button:active { background: ${COLORS.accent}; color: ${COLORS.bgDark}; transform: translateY(1px); }
    .he-root button.active { background: linear-gradient(180deg, ${COLORS.accent}, #96a3ff); color: ${COLORS.bgDark}; font-weight: 700; border-color: rgba(255,255,255,0.18); }
    .he-root .he-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      border-radius: 999px;
      background: rgba(10,14,24,0.72);
      border: 1px solid rgba(124,140,255,0.2);
      color: ${COLORS.textDim};
      backdrop-filter: blur(12px);
      font-size: ${FONT.size.xs};
      box-shadow: 0 8px 24px rgba(0,0,0,0.18);
    }
    .he-root .he-tab {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 7px 10px;
      border-radius: 8px;
      color: ${COLORS.textDim};
      cursor: pointer;
      border: 1px solid transparent;
      user-select: none;
      transition: background 0.12s, border-color 0.12s, color 0.12s;
    }
    .he-root .he-tab:hover { background: rgba(255,255,255,0.03); color: ${COLORS.text}; }
    .he-root .he-tab.active {
      background: linear-gradient(180deg, rgba(124,140,255,0.22), rgba(99,212,255,0.12));
      border-color: rgba(124,140,255,0.3);
      color: ${COLORS.text};
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
    }
    .he-root .he-section-card {
      background: linear-gradient(180deg, rgba(26,34,51,0.95), rgba(16,22,34,0.98));
      border: 1px solid ${COLORS.border};
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.14);
    }
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
