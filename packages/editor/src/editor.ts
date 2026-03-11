import type { Engine } from '@engine/core';
import { Phase } from '@engine/scheduler';
import {
  LocalTransform, Visible, MeshRef, MaterialRef,
} from '@engine/ecs';
import {
  GPUMesh, createSphere, createPlane,
} from '@engine/renderer-webgpu';
import { injectEditorStyles, COLORS, SIZES, el } from './ui/theme.js';
import { MenuBar, type MenuGroup } from './ui/menu-bar.js';
import { Toolbar, type ToolMode, type PlayState } from './ui/toolbar.js';
import { StatusBar } from './ui/status-bar.js';
import { LayoutManager } from './layout/layout-manager.js';
import { Viewport } from './viewport/viewport.js';
import { Selection } from './picking/selection.js';
import { SceneHierarchyPanel } from './panels/scene-hierarchy-panel.js';
import { PropertiesPanel } from './panels/properties-panel.js';
import { AssetBrowser } from './assets/asset-browser.js';
import { SceneSerializer } from './scene/scene-serializer.js';
import { UndoRedoStack } from './scene/undo-redo.js';
import { MaterialEditor } from './panels/material-editor.js';

export interface EditorOptions {
  container?: HTMLElement;
}

/**
 * The main Editor entry point.
 *
 * Wraps an Engine instance with a full editor UI including:
 *  - Menu bar with File/Edit/View/Scene menus
 *  - Toolbar with transform tools and play/pause/stop
 *  - Left sidebar: Scene Hierarchy + Asset Browser
 *  - Right sidebar: Properties Panel
 *  - Central viewport with grid, gizmos, and picking
 *  - Status bar with FPS and info
 *  - Undo/redo stack
 *  - Scene serialization (save/load)
 *
 * Usage:
 *   const editor = await Editor.create(engine);
 *   // Editor takes over the page layout
 */
export class Editor {
  readonly engine: Engine;
  readonly selection: Selection;
  readonly undoStack: UndoRedoStack;
  readonly serializer: SceneSerializer;
  readonly viewport: Viewport;

  readonly menuBar: MenuBar;
  readonly toolbar: Toolbar;
  readonly statusBar: StatusBar;
  readonly layout: LayoutManager;
  readonly hierarchy: SceneHierarchyPanel;
  readonly properties: PropertiesPanel;
  readonly materialEditor: MaterialEditor;
  readonly assetBrowser: AssetBrowser;

  private _shell: HTMLDivElement;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _playStateBeforePause: PlayState = 'stopped';
  private _wasRunning = false;

  private constructor(engine: Engine, options: EditorOptions = {}) {
    this.engine = engine;
    this.selection = new Selection();
    this.undoStack = new UndoRedoStack();
    this.serializer = new SceneSerializer(engine);

    injectEditorStyles();

    const container = options.container ?? document.body;

    // Build the editor shell (full-page layout)
    this._shell = el('div', {
      position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
      display: 'flex', flexDirection: 'column',
      background: COLORS.bg, overflow: 'hidden',
    });
    this._shell.className = 'he-root';

    // Menu bar
    this.menuBar = new MenuBar(this._buildMenuGroups());
    this._shell.appendChild(this.menuBar.root);

    // Toolbar
    this.toolbar = new Toolbar({
      onToolChange: (tool) => this._onToolChange(tool),
      onPlayStateChange: (state) => this._onPlayStateChange(state),
      onSnap: (enabled) => { /* snap state is read from toolbar.snap */ },
      onGridToggle: () => { this.viewport.showGrid = !this.viewport.showGrid; },
      onUndo: () => this.undoStack.undo(),
      onRedo: () => this.undoStack.redo(),
    });
    this._shell.appendChild(this.toolbar.root);

    // Layout
    this.layout = new LayoutManager();
    this._shell.appendChild(this.layout.root);
    this.layout.root.style.flex = '1';

    // Status bar
    this.statusBar = new StatusBar();
    this._shell.appendChild(this.statusBar.root);

    // Move engine canvas into the viewport slot
    const canvas = engine.canvas.element;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    this.layout.viewport.appendChild(canvas);

    // Create viewport controller
    this.viewport = new Viewport({
      engine,
      container: this.layout.viewport,
      selection: this.selection,
    });

    // Scene hierarchy panel (left sidebar)
    this.hierarchy = new SceneHierarchyPanel(engine, this.selection);
    this.layout.addPanel({
      id: 'hierarchy', title: 'Scene Hierarchy', side: 'left',
      content: this.hierarchy.root,
    });

    // Asset browser panel (left sidebar)
    this.assetBrowser = new AssetBrowser(engine);
    this.layout.addPanel({
      id: 'assets', title: 'Assets', side: 'left',
      content: this.assetBrowser.root,
    });

    // Properties panel (right sidebar)
    this.properties = new PropertiesPanel(engine, this.selection, this.undoStack);
    this.layout.addPanel({
      id: 'properties', title: 'Properties', side: 'right',
      content: this.properties.root,
    });

    // Material editor panel (right sidebar)
    this.materialEditor = new MaterialEditor(engine, this.selection);
    this.layout.addPanel({
      id: 'material', title: 'Material', side: 'right',
      content: this.materialEditor.root,
    });

    container.appendChild(this._shell);

    // Register editor update system
    engine.scheduler.addSystem(Phase.DIAGNOSTICS, () => this._onDiagnostics(), 'editor-update', 200);

    // Register camera update in INPUT phase
    engine.scheduler.addSystem(Phase.INPUT, (ctx) => {
      this.viewport.updateCamera(ctx.deltaTime);
    }, 'editor-camera', 0);

    this._setupKeyboardShortcuts();

    console.log(
      '%c[Editor] Horizon Editor ready. Ctrl+S=Save, Ctrl+Z=Undo, Q/W/E/R=Tools',
      'color: #89b4fa; font-weight: bold',
    );
  }

  static create(engine: Engine, options?: EditorOptions): Editor {
    return new Editor(engine, options);
  }

  private _buildMenuGroups(): MenuGroup[] {
    return [
      {
        label: 'File',
        items: [
          { label: 'New Scene', shortcut: 'Ctrl+N', action: () => this._newScene() },
          { label: 'Open Scene...', shortcut: 'Ctrl+O', action: () => this.serializer.loadSceneFile() },
          { label: 'Save Scene', shortcut: 'Ctrl+S', action: () => this.serializer.downloadScene() },
          { separator: true, label: '' },
          { label: 'Import Asset...', action: () => this._importAsset() },
          { separator: true, label: '' },
          { label: 'Export Scene as JSON', action: () => {
            const json = this.serializer.toJSON('scene');
            navigator.clipboard.writeText(json);
            this.statusBar.setLeft('Scene copied to clipboard');
          }},
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Undo', shortcut: 'Ctrl+Z', action: () => this.undoStack.undo() },
          { label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: () => this.undoStack.redo() },
          { separator: true, label: '' },
          { label: 'Delete Selected', shortcut: 'Del', action: () => this._deleteSelected() },
          { label: 'Duplicate Selected', shortcut: 'Ctrl+D', action: () => this._duplicateSelected() },
          { separator: true, label: '' },
          { label: 'Select All', shortcut: 'Ctrl+A', action: () => this._selectAll() },
          { label: 'Deselect All', shortcut: 'Esc', action: () => this.selection.clear() },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Toggle Grid', shortcut: 'G', action: () => { this.viewport.showGrid = !this.viewport.showGrid; } },
          { separator: true, label: '' },
          { label: 'Perspective', action: () => this.viewport.camera.setPreset('perspective') },
          { label: 'Top', action: () => this.viewport.camera.setPreset('top') },
          { label: 'Front', action: () => this.viewport.camera.setPreset('front') },
          { label: 'Right', action: () => this.viewport.camera.setPreset('right') },
          { separator: true, label: '' },
          { label: 'Focus Selected', shortcut: 'F', action: () => this._focusSelected() },
          { label: 'Reset Camera', action: () => { this.viewport.camera.target = [0, 0, 0]; this.viewport.camera.distance = 10; } },
        ],
      },
      {
        label: 'Scene',
        items: [
          { label: 'Add Empty Entity', action: () => this._addEntity() },
          { label: 'Add Cube', action: () => this._addPrimitive('cube') },
          { label: 'Add Sphere', action: () => this._addPrimitive('sphere') },
          { label: 'Add Plane', action: () => this._addPrimitive('plane') },
          { separator: true, label: '' },
          { label: 'Clear Scene', action: () => this._clearScene() },
        ],
      },
    ];
  }

  private _onToolChange(tool: ToolMode): void {
    const modeMap: Record<ToolMode, string> = {
      select: 'select',
      translate: 'translate',
      rotate: 'rotate',
      scale: 'scale',
    };
    if (tool !== 'select') {
      this.viewport.gizmoMode = tool as any;
    }
    this.statusBar.setLeft(`Tool: ${tool.charAt(0).toUpperCase() + tool.slice(1)}`);
  }

  private _onPlayStateChange(state: PlayState): void {
    switch (state) {
      case 'playing':
        if (!this._wasRunning) {
          this._wasRunning = true;
          this.engine.start();
        }
        this.statusBar.setLeft('Playing...');
        break;
      case 'paused':
        this.statusBar.setLeft('Paused');
        break;
      case 'stopped':
        if (this._wasRunning) {
          this._wasRunning = false;
        }
        this.statusBar.setLeft('Ready');
        break;
    }
  }

  private _onDiagnostics(): void {
    // Update FPS
    const fps = this.engine.frameMetrics.fps.snapshot();
    this.statusBar.setFps(fps.avg);

    // Update hierarchy
    this.hierarchy.update();
    this.properties.update();

    // Update status center
    const entityCount = this.selection.count;
    this.statusBar.setCenter(
      entityCount > 0 ? `${entityCount} selected` : '',
    );
  }

  private _newScene(): void {
    // Destroy all entities
    this._clearScene();
    this.undoStack.clear();
    this.statusBar.setLeft('New scene created');
  }

  private _clearScene(): void {
    const world = this.engine.world;
    const ids: number[] = [];
    world.query(Visible).each((arch, count) => {
      const data = arch.entities.data as Uint32Array;
      for (let i = 0; i < count; i++) ids.push(data[i]!);
    });
    for (const id of ids) {
      if (world.has(id)) world.destroy(id);
    }
    this.selection.clear();
  }

  private _deleteSelected(): void {
    const world = this.engine.world;
    for (const id of this.selection.ids) {
      if (world.has(id)) world.destroy(id);
    }
    this.selection.clear();
  }

  private _duplicateSelected(): void {
    const world = this.engine.world;
    const copyComp = (src: number, dst: number, comp: any) => {
      if (!world.hasComponent(src, comp)) return;
      world.addComponent(dst, comp);
      for (const field of comp.fieldNames) {
        world.setField(dst, comp, field, world.getField(src, comp, field));
      }
    };
    for (const srcId of this.selection.ids) {
      if (!world.has(srcId)) continue;
      const eid = world.spawn().id;
      copyComp(srcId, eid, LocalTransform);
      copyComp(srcId, eid, Visible);
      copyComp(srcId, eid, MeshRef);
      copyComp(srcId, eid, MaterialRef);
    }
  }

  private _selectAll(): void {
    const ids: number[] = [];
    const world = this.engine.world;
    world.query(Visible).each((arch, count) => {
      const data = arch.entities.data as Uint32Array;
      for (let i = 0; i < count; i++) ids.push(data[i]!);
    });
    this.selection.set(ids);
  }

  private _focusSelected(): void {
    const first = this.selection.first;
    if (first === null) return;
    const world = this.engine.world;
    if (!world.hasComponent(first, LocalTransform)) return;
    const px = world.getField(first, LocalTransform, 'px');
    const py = world.getField(first, LocalTransform, 'py');
    const pz = world.getField(first, LocalTransform, 'pz');
    this.viewport.camera.target = [px, py, pz];
  }

  private _addEntity(): void {
    const world = this.engine.world;
    const id = world.spawn().id;
    world.addComponent(id, LocalTransform);
    world.addComponent(id, Visible);
    this.selection.select(id);
    this.statusBar.setLeft(`Created Entity #${id}`);
  }

  private _addPrimitive(type: 'cube' | 'sphere' | 'plane'): void {
    let meshData;
    switch (type) {
      case 'sphere': meshData = createSphere(1, 32, 16); break;
      case 'plane': meshData = createPlane(10, 10, 1, 1); break;
      case 'cube': meshData = createSphere(1, 6, 4); break;
    }

    const mesh = GPUMesh.create(this.engine.pbrRenderer.device, meshData);
    const meshHandle = this.engine.registerMesh(mesh);
    const { handle: matHandle } = this.engine.createMaterial();

    const id = this.engine.world.spawn().id;
    this.engine.world.addComponent(id, LocalTransform);
    this.engine.world.addComponent(id, Visible);
    this.engine.world.addComponent(id, MeshRef);
    this.engine.world.addComponent(id, MaterialRef);
    this.engine.world.setField(id, MeshRef, 'handle', meshHandle);
    this.engine.world.setField(id, MaterialRef, 'handle', matHandle);

    this.selection.select(id);
    this.statusBar.setLeft(`Added ${type} (Entity #${id})`);
    this.assetBrowser.refresh();
  }

  private _importAsset(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.gltf,.glb,.hdr,.png,.jpg,.wav,.mp3,.json,.hscene';
    input.addEventListener('change', () => {
      if (input.files?.length) {
        this._handleImportedFiles(input.files);
      }
    });
    input.click();
  }

  private _handleImportedFiles(files: FileList): void {
    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'hscene' || ext === 'json') {
        file.text().then(text => {
          this.serializer.fromJSON(text);
          this.statusBar.setLeft(`Loaded scene: ${file.name}`);
        });
      } else {
        this.assetBrowser.addAsset({
          id: `import-${Date.now()}-${file.name}`,
          name: file.name,
          type: this._guessAssetType(ext ?? ''),
        });
        this.statusBar.setLeft(`Imported: ${file.name}`);
      }
    }
  }

  private _guessAssetType(ext: string): import('./assets/asset-browser.js').AssetType {
    switch (ext) {
      case 'gltf': case 'glb': return 'model';
      case 'hdr': return 'texture';
      case 'png': case 'jpg': case 'jpeg': return 'texture';
      case 'wav': case 'mp3': case 'ogg': return 'audio';
      default: return 'unknown';
    }
  }

  private _setupKeyboardShortcuts(): void {
    this._keyHandler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Tool shortcuts
      if (!e.ctrlKey && !e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'q': this.toolbar.setTool('select'); return;
          case 'w': this.toolbar.setTool('translate'); return;
          case 'e': this.toolbar.setTool('rotate'); return;
          case 'r': this.toolbar.setTool('scale'); return;
          case 'g': this.viewport.showGrid = !this.viewport.showGrid; return;
          case 'f': this._focusSelected(); return;
          case 'delete': case 'backspace': this._deleteSelected(); return;
          case 'escape': this.selection.clear(); return;
        }
      }

      // Ctrl shortcuts
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'z':
            e.preventDefault();
            if (e.shiftKey) this.undoStack.redo();
            else this.undoStack.undo();
            return;
          case 's':
            e.preventDefault();
            this.serializer.downloadScene();
            return;
          case 'd':
            e.preventDefault();
            this._duplicateSelected();
            return;
          case 'n':
            e.preventDefault();
            this._newScene();
            return;
        }
      }
    };
    window.addEventListener('keydown', this._keyHandler);
  }

  destroy(): void {
    if (this._keyHandler) {
      window.removeEventListener('keydown', this._keyHandler);
    }
    this.engine.scheduler.removeSystemByLabel(Phase.DIAGNOSTICS, 'editor-update');
    this.engine.scheduler.removeSystemByLabel(Phase.INPUT, 'editor-camera');
    this.viewport.destroy();
    this.menuBar.destroy();
    this.toolbar.destroy();
    this.statusBar.destroy();
    this.layout.destroy();
    this._shell.remove();
  }
}
