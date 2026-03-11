import type { Engine } from '@engine/core';
import { Phase } from '@engine/scheduler';
import { PerfPanel } from './perf-panel.js';
import { DebugDraw } from './debug-draw.js';
import { DebugSystem } from './debug-system.js';
import { EntityInspector } from './entity-inspector.js';
import { SceneHierarchy } from './scene-hierarchy.js';
import { ComponentEditor } from './component-editor.js';

export interface DevToolsOptions {
  /** Auto-show perf panel on attach. Default: false */
  showPerf?: boolean;
  /** Auto-show hierarchy panel on attach. Default: false */
  showHierarchy?: boolean;
  /** Auto-show inspector panel on attach. Default: false */
  showInspector?: boolean;
}

/**
 * Main DevTools entry point. Attaches all debug panels and keyboard shortcuts to an engine.
 *
 * Keyboard shortcuts:
 *   F1  — Toggle performance panel
 *   F2  — Toggle entity inspector
 *   F3  — Toggle scene hierarchy
 *   F4  — Toggle component editor
 *   F9  — Toggle all panels
 */
export class DevTools {
  readonly perfPanel: PerfPanel;
  readonly debugDraw: DebugDraw;
  readonly debugSystem: DebugSystem;
  readonly inspector: EntityInspector;
  readonly hierarchy: SceneHierarchy;
  readonly componentEditor: ComponentEditor;

  private _engine: Engine;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;

  private constructor(engine: Engine, options?: DevToolsOptions) {
    this._engine = engine;

    // Create all panels
    this.perfPanel = new PerfPanel();
    this.inspector = new EntityInspector(engine);
    this.hierarchy = new SceneHierarchy(engine);
    this.componentEditor = new ComponentEditor(engine);

    // Create debug draw (requires GPU device from PBR renderer)
    let debugDraw: DebugDraw | null = null;
    try {
      const device = engine.pbrRenderer.device;
      const format = engine.gpu.format;
      debugDraw = new DebugDraw(device, format);
    } catch {
      // No PBR renderer — skip debug draw
    }
    this.debugDraw = debugDraw!;

    // Create debug system
    this.debugSystem = new DebugSystem(engine, this.perfPanel, debugDraw);

    // Wire up cross-panel connections
    this.hierarchy.bindInspector(this.inspector);
    this.inspector.onSelect((id) => {
      this.componentEditor.setEntity(id);
    });

    // Register diagnostics update system
    this.debugSystem.register();

    // Register hierarchy/inspector update in diagnostics phase
    engine.scheduler.addSystem(Phase.DIAGNOSTICS, () => {
      this.hierarchy.update();
      this.inspector.update();
      this.componentEditor.update();
    }, 'devtools-panels', 100);

    // Apply initial visibility
    if (options?.showPerf) this.perfPanel.show();
    if (options?.showHierarchy) this.hierarchy.show();
    if (options?.showInspector) this.inspector.show();

    this._setupKeyboardShortcuts();

    console.log(
      '%c[DevTools] Attached. Shortcuts: F1=Perf, F2=Inspector, F3=Hierarchy, F4=Components, F9=All',
      'color: #FF9800; font-weight: bold',
    );
  }

  /**
   * Attach DevTools to an engine instance.
   */
  static attach(engine: Engine, options?: DevToolsOptions): DevTools {
    return new DevTools(engine, options);
  }

  /** Show all panels. */
  showAll(): void {
    this.perfPanel.show();
    this.inspector.show();
    this.hierarchy.show();
    this.componentEditor.show();
  }

  /** Hide all panels. */
  hideAll(): void {
    this.perfPanel.hide();
    this.inspector.hide();
    this.hierarchy.hide();
    this.componentEditor.hide();
  }

  /** Toggle all panels. */
  toggleAll(): void {
    if (this.perfPanel.visible) {
      this.hideAll();
    } else {
      this.showAll();
    }
  }

  destroy(): void {
    if (this._keyHandler) {
      window.removeEventListener('keydown', this._keyHandler);
    }
    this._engine.scheduler.removeSystemByLabel(Phase.DIAGNOSTICS, 'devtools-panels');
    this.debugSystem.destroy();
    this.inspector.destroy();
    this.hierarchy.destroy();
    this.componentEditor.destroy();
    this.debugDraw?.destroy();
  }

  private _setupKeyboardShortcuts(): void {
    this._keyHandler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case 'F1': e.preventDefault(); this.perfPanel.toggle(); break;
        case 'F2': e.preventDefault(); this.inspector.toggle(); break;
        case 'F3': e.preventDefault(); this.hierarchy.toggle(); break;
        case 'F4': e.preventDefault(); this.componentEditor.toggle(); break;
        case 'F9': e.preventDefault(); this.toggleAll(); break;
      }
    };
    window.addEventListener('keydown', this._keyHandler);
  }
}
