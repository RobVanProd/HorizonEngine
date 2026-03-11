import type { Engine } from '@engine/core';
import { Phase } from '@engine/scheduler';
import {
  AnimationPlayer, LocalTransform, Visible, MeshRef, MaterialRef, WorldMatrix,
} from '@engine/ecs';
import {
  GPUMesh, createSphere, createPlane,
} from '@engine/renderer-webgpu';
import { injectEditorStyles, COLORS, SIZES, el } from './ui/theme.js';
import { MenuBar, type MenuGroup } from './ui/menu-bar.js';
import { Toolbar, type ToolMode, type PlayState } from './ui/toolbar.js';
import { StatusBar } from './ui/status-bar.js';
import { CommandPalette } from './ui/command-palette.js';
import { LayoutManager } from './layout/layout-manager.js';
import { Viewport } from './viewport/viewport.js';
import { Selection } from './picking/selection.js';
import { SceneHierarchyPanel } from './panels/scene-hierarchy-panel.js';
import { PropertiesPanel } from './panels/properties-panel.js';
import { AssetBrowser, type AssetEntry } from './assets/asset-browser.js';
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
  readonly commandPalette: CommandPalette;

  private _shell: HTMLDivElement;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _playStateBeforePause: PlayState = 'stopped';
  private _wasRunning = false;
  private _leftTab: 'world' | 'content' = 'world';
  private _rightTab: 'inspector' | 'systems' | 'assist' = 'inspector';
  private _leftTabBar!: HTMLElement;
  private _rightTabBar!: HTMLElement;
  private _leftViews = new Map<'world' | 'content', HTMLElement>();
  private _rightViews = new Map<'inspector' | 'systems' | 'assist', HTMLElement>();
  private _systemsPanel!: HTMLDivElement;
  private _assistPanel!: HTMLDivElement;

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
      onCommandPalette: () => this._openCommandPalette(),
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

    this.hierarchy = new SceneHierarchyPanel(engine, this.selection);
    this.assetBrowser = new AssetBrowser(engine);
    this.properties = new PropertiesPanel(engine, this.selection, this.undoStack);
    this.materialEditor = new MaterialEditor(engine, this.selection);
    this.commandPalette = new CommandPalette();

    this.assetBrowser.onSelect((asset) => {
      this.statusBar.setLeft(`Selected asset: ${asset.name}`);
    });
    this.assetBrowser.onDrop((files) => {
      this._handleImportedFiles(files);
    });

    this.layout.mountSidebar('left', this._buildLeftWorkspace());
    this.layout.mountSidebar('right', this._buildRightWorkspace());
    this._setupViewportAssetDrop();

    container.appendChild(this._shell);
    this._configureCommandPalette();

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

  private _buildLeftWorkspace(): HTMLElement {
    const root = el('div', {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      padding: '10px',
      gap: '10px',
    });

    const tabBar = this._makeTabBar([
      { id: 'world', label: 'World' },
      { id: 'content', label: 'Content' },
    ], this._leftTab, (id) => this._setLeftTab(id as 'world' | 'content'));
    this._leftTabBar = tabBar;
    root.appendChild(tabBar);

    const worldView = this._wrapWorkspaceView('Scene Workspace', 'Hierarchy, selection, and entity management');
    worldView.appendChild(this.hierarchy.root);
    this._leftViews.set('world', worldView);

    const contentView = this._wrapWorkspaceView('Content Workspace', 'Assets, imports, and reusable content');
    contentView.appendChild(this.assetBrowser.root);
    this._leftViews.set('content', contentView);

    root.appendChild(worldView);
    root.appendChild(contentView);
    this._setLeftTab(this._leftTab);
    return root;
  }

  private _buildRightWorkspace(): HTMLElement {
    const root = el('div', {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      padding: '10px',
      gap: '10px',
    });

    const tabBar = this._makeTabBar([
      { id: 'inspector', label: 'Inspector' },
      { id: 'systems', label: 'Systems' },
      { id: 'assist', label: 'Assist' },
    ], this._rightTab, (id) => this._setRightTab(id as 'inspector' | 'systems' | 'assist'));
    this._rightTabBar = tabBar;
    root.appendChild(tabBar);

    const inspectorView = this._wrapWorkspaceView('Selection Inspector', 'Components, materials, and object state');
    inspectorView.style.display = 'flex';
    inspectorView.style.flexDirection = 'column';
    inspectorView.style.gap = '10px';
    inspectorView.appendChild(this._cardWrap(this.properties.root));
    inspectorView.appendChild(this._cardWrap(this.materialEditor.root));
    this._rightViews.set('inspector', inspectorView);

    this._systemsPanel = el('div', { display: 'flex', flexDirection: 'column', gap: '10px', height: '100%', overflowY: 'auto' });
    const systemsView = this._wrapWorkspaceView('Systems Context', 'How this selection participates in engine systems');
    systemsView.appendChild(this._systemsPanel);
    this._rightViews.set('systems', systemsView);

    this._assistPanel = el('div', { display: 'flex', flexDirection: 'column', gap: '10px', height: '100%', overflowY: 'auto' });
    const assistView = this._wrapWorkspaceView('Assist', 'AI-native workflows for setup, debugging, and generation');
    assistView.appendChild(this._assistPanel);
    this._rightViews.set('assist', assistView);

    root.appendChild(inspectorView);
    root.appendChild(systemsView);
    root.appendChild(assistView);
    this._setRightTab(this._rightTab);
    this._rebuildAssistPanel();
    return root;
  }

  private _makeTabBar(
    items: Array<{ id: string; label: string }>,
    activeId: string,
    onSelect: (id: string) => void,
  ): HTMLElement {
    const bar = el('div', {
      display: 'flex',
      gap: '6px',
      padding: '4px',
      borderRadius: '10px',
      background: 'rgba(8,12,20,0.55)',
      border: `1px solid ${COLORS.border}`,
    });
    for (const item of items) {
      const tab = el('div', undefined, { 'data-tab-id': item.id });
      tab.className = `he-tab${item.id === activeId ? ' active' : ''}`;
      tab.textContent = item.label;
      tab.addEventListener('click', () => onSelect(item.id));
      bar.appendChild(tab);
    }
    return bar;
  }

  private _wrapWorkspaceView(title: string, subtitle: string): HTMLDivElement {
    const view = el('div', {
      display: 'flex',
      flexDirection: 'column',
      flex: '1',
      minHeight: '0',
      overflow: 'hidden',
      gap: '10px',
    });
    const intro = el('div', {
      padding: '10px 12px',
      borderRadius: '10px',
      border: `1px solid ${COLORS.border}`,
      background: 'linear-gradient(180deg, rgba(20,28,42,0.95), rgba(10,14,24,0.98))',
    });
    const h = el('div', { color: COLORS.text, fontWeight: '700', marginBottom: '4px', letterSpacing: '0.03em' });
    h.textContent = title;
    const s = el('div', { color: COLORS.textMuted, fontSize: '11px', lineHeight: '1.5' });
    s.textContent = subtitle;
    intro.appendChild(h);
    intro.appendChild(s);
    view.appendChild(intro);
    return view;
  }

  private _cardWrap(content: HTMLElement): HTMLElement {
    const card = el('div', {
      display: 'flex',
      flexDirection: 'column',
      minHeight: '0',
    });
    card.className = 'he-section-card';
    card.appendChild(content);
    return card;
  }

  private _setLeftTab(tab: 'world' | 'content'): void {
    this._leftTab = tab;
    for (const [id, view] of this._leftViews) {
      view.style.display = id === tab ? 'flex' : 'none';
    }
    this._syncTabClasses(this._leftTabBar, tab);
  }

  private _setRightTab(tab: 'inspector' | 'systems' | 'assist'): void {
    this._rightTab = tab;
    for (const [id, view] of this._rightViews) {
      view.style.display = id === tab ? 'flex' : 'none';
    }
    this._syncTabClasses(this._rightTabBar, tab);
  }

  private _syncTabClasses(tabBar: HTMLElement, activeId: string): void {
    tabBar.querySelectorAll<HTMLElement>('[data-tab-id]').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset['tabId'] === activeId);
    });
  }

  private _configureCommandPalette(): void {
    this.commandPalette.setItems([
      { id: 'new-entity', title: 'Create Empty Entity', subtitle: 'Scene', keywords: ['entity', 'create', 'scene'], action: () => this._addEntity() },
      { id: 'sphere', title: 'Add Sphere', subtitle: 'Primitive', keywords: ['primitive', 'sphere', 'mesh'], action: () => this._addPrimitive('sphere') },
      { id: 'plane', title: 'Add Plane', subtitle: 'Primitive', keywords: ['primitive', 'plane', 'ground'], action: () => this._addPrimitive('plane') },
      { id: 'focus', title: 'Focus Selected', subtitle: 'Viewport', keywords: ['camera', 'focus'], action: () => this._focusSelected() },
      { id: 'toggle-grid', title: 'Toggle Grid', subtitle: 'Viewport', keywords: ['grid', 'viewport'], action: () => { this.viewport.showGrid = !this.viewport.showGrid; } },
      { id: 'world-tab', title: 'Open World Workspace', subtitle: 'Left Panel', keywords: ['world', 'hierarchy'], action: () => this._setLeftTab('world') },
      { id: 'content-tab', title: 'Open Content Workspace', subtitle: 'Left Panel', keywords: ['content', 'assets'], action: () => this._setLeftTab('content') },
      { id: 'systems-tab', title: 'Open Systems Context', subtitle: 'Right Panel', keywords: ['systems', 'debug'], action: () => this._setRightTab('systems') },
      { id: 'assist-tab', title: 'Open Assist Panel', subtitle: 'Right Panel', keywords: ['assist', 'ai'], action: () => this._setRightTab('assist') },
      { id: 'save-scene', title: 'Save Scene', subtitle: 'File', keywords: ['save', 'scene'], action: () => this.serializer.downloadScene() },
    ]);
  }

  private _openCommandPalette(): void {
    this.commandPalette.show();
  }

  private _rebuildSystemsPanel(): void {
    this._systemsPanel.innerHTML = '';
    const selected = this.selection.first;
    const world = this.engine.world;

    this._systemsPanel.appendChild(this._infoCard('Selection', [
      `Entity: ${selected ?? 'none'}`,
      `Selected: ${this.selection.count}`,
      `Archetypes: ${world.archetypeCount}`,
      `Systems: ${this.engine.scheduler.getSystemCount()}`,
    ]));

    if (selected === null || !world.has(selected)) {
      this._systemsPanel.appendChild(this._textCard('No entity selected', 'Pick an object to inspect its ECS components, render path, and runtime participation.'));
      return;
    }

    const comps: string[] = [];
    for (const comp of [LocalTransform, WorldMatrix, Visible, MeshRef, MaterialRef]) {
      if (world.hasComponent(selected, comp)) comps.push(comp.name);
    }
    this._systemsPanel.appendChild(this._infoCard('Component Membership', comps.length > 0 ? comps : ['No core components']));

    const systemHints: string[] = [];
    if (world.hasComponent(selected, LocalTransform)) systemHints.push('Transform phase');
    if (world.hasComponent(selected, MeshRef) && world.hasComponent(selected, MaterialRef) && world.hasComponent(selected, Visible)) systemHints.push('Render phase');
    if (world.hasComponent(selected, MaterialRef)) systemHints.push('Inspector material editing');
    this._systemsPanel.appendChild(this._infoCard('System Participation', systemHints.length > 0 ? systemHints : ['Selection only']));

    const renderState = [
      `Meshes: ${this.engine.meshes.size}`,
      `Materials: ${this.engine.materials.size}`,
      `Audio clips: ${this.engine.audioClips.size}`,
      `Camera: ${this.engine.cameraEye.map((v) => v.toFixed(2)).join(', ')}`,
    ];
    this._systemsPanel.appendChild(this._infoCard('Runtime State', renderState));
  }

  private _rebuildAssistPanel(): void {
    this._assistPanel.innerHTML = '';
    this._assistPanel.appendChild(this._textCard('AI Assist', 'Horizon treats AI as a collaborator in workflow. Use these quick actions to jump into common editor and engine tasks.'));

    const actions = [
      { label: 'Explain Selection', action: () => this.statusBar.setLeft(`Assist: inspect Entity #${this.selection.first ?? 'none'}`) },
      { label: 'Generate Material Setup', action: () => this._setRightTab('inspector') },
      { label: 'Open Systems Context', action: () => this._setRightTab('systems') },
      { label: 'Create Primitive', action: () => this._openCommandPalette() },
      { label: 'Save Scene Snapshot', action: () => this.serializer.downloadScene() },
    ];

    const card = el('div', {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      padding: '12px',
    });
    card.className = 'he-section-card';
    for (const item of actions) {
      const btn = document.createElement('button');
      btn.textContent = item.label;
      btn.addEventListener('click', item.action);
      card.appendChild(btn);
    }
    this._assistPanel.appendChild(card);
  }

  private _infoCard(title: string, lines: string[]): HTMLElement {
    const card = el('div', { padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' });
    card.className = 'he-section-card';
    const h = el('div', { color: COLORS.text, fontWeight: '700' });
    h.textContent = title;
    card.appendChild(h);
    for (const line of lines) {
      const row = el('div', {
        color: COLORS.textDim,
        fontSize: '11px',
        fontFamily: line.includes(':') ? 'Consolas, "Fira Code", monospace' : '',
      });
      row.textContent = line;
      card.appendChild(row);
    }
    return card;
  }

  private _textCard(title: string, body: string): HTMLElement {
    const card = el('div', { padding: '12px', display: 'flex', flexDirection: 'column', gap: '6px' });
    card.className = 'he-section-card';
    const h = el('div', { color: COLORS.text, fontWeight: '700' });
    h.textContent = title;
    const p = el('div', { color: COLORS.textMuted, fontSize: '11px', lineHeight: '1.6' });
    p.textContent = body;
    card.appendChild(h);
    card.appendChild(p);
    return card;
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
    this.viewport.showGizmo = tool !== 'select';
    if (tool !== 'select') this.viewport.gizmoMode = tool;
    this.statusBar.setLeft(`Tool: ${tool.charAt(0).toUpperCase() + tool.slice(1)}`);
  }

  private _onPlayStateChange(state: PlayState): void {
    this._setAnimationPlayback(state);
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

  private _setAnimationPlayback(state: PlayState): void {
    const world = this.engine.world;
    const PLAYING_FLAG = 1;
    world.query(AnimationPlayer).each((arch, count) => {
      const ids = arch.entities.data as Uint32Array;
      for (let i = 0; i < count; i++) {
        const id = ids[i]!;
        const flags = world.getField(id, AnimationPlayer, 'flags');
        const nextFlags = state === 'playing' ? (flags | PLAYING_FLAG) : (flags & ~PLAYING_FLAG);
        world.setField(id, AnimationPlayer, 'flags', nextFlags);
        if (state === 'stopped') {
          world.setField(id, AnimationPlayer, 'time', 0);
        }
      }
    });
  }

  private _onDiagnostics(): void {
    const fps = this.engine.frameMetrics.fps.snapshot();
    this.statusBar.setFps(fps.avg, 'WebGPU | Horizon v0.6');
    this.hierarchy.update();
    this.properties.update();
    this.materialEditor.update();
    this._rebuildSystemsPanel();

    const entityCount = this.selection.count;
    const selected = this.selection.first;
    this.statusBar.setCenter(entityCount > 0 ? `${entityCount} selected` : 'No selection');
    this.statusBar.setLeft(this.toolbar.playState === 'playing' ? 'Playing' : 'Ready');

    let selectedTransform = '';
    if (selected !== null && this.engine.world.has(selected) && this.engine.world.hasComponent(selected, LocalTransform)) {
      const px = this.engine.world.getField(selected, LocalTransform, 'px');
      const py = this.engine.world.getField(selected, LocalTransform, 'py');
      const pz = this.engine.world.getField(selected, LocalTransform, 'pz');
      selectedTransform = `${px.toFixed(2)}, ${py.toFixed(2)}, ${pz.toFixed(2)}`;
    }
    this.viewport.syncHud({
      fps: fps.avg,
      selectedLabel: selected !== null ? `Entity #${selected}` : 'No selection',
      selectedTransform,
      entities: this.engine.world.entityCount,
      backend: 'WebGPU',
      renderMode: 'Lit',
    });
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
      copyComp(srcId, eid, WorldMatrix);
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
    world.addComponent(id, LocalTransform, {
      px: 0, py: 0, pz: 0, rotY: 0,
      scaleX: 1, scaleY: 1, scaleZ: 1,
    });
    world.addComponent(id, WorldMatrix, {
      m0: 1, m1: 0, m2: 0, m3: 0,
      m4: 0, m5: 1, m6: 0, m7: 0,
      m8: 0, m9: 0, m10: 1, m11: 0,
      m12: 0, m13: 0, m14: 0, m15: 1,
    });
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
    this.engine.world.addComponent(id, LocalTransform, {
      px: 0, py: type === 'plane' ? 0 : 1, pz: 0, rotY: 0,
      scaleX: 1, scaleY: 1, scaleZ: 1,
    });
    this.engine.world.addComponent(id, WorldMatrix, {
      m0: 1, m1: 0, m2: 0, m3: 0,
      m4: 0, m5: 1, m6: 0, m7: 0,
      m8: 0, m9: 0, m10: 1, m11: 0,
      m12: 0, m13: 0, m14: 0, m15: 1,
    });
    this.engine.world.addComponent(id, Visible);
    this.engine.world.addComponent(id, MeshRef);
    this.engine.world.addComponent(id, MaterialRef);
    this.engine.world.setField(id, MeshRef, 'handle', meshHandle);
    this.engine.world.setField(id, MaterialRef, 'handle', matHandle);

    this.selection.select(id);
    this.statusBar.setLeft(`Added ${type} (Entity #${id})`);
    this.assetBrowser.refresh();
  }

  private _setupViewportAssetDrop(): void {
    const target = this.layout.viewport;
    target.addEventListener('dragover', (e) => {
      const types = e.dataTransfer ? Array.from(e.dataTransfer.types) : [];
      if (types.includes('application/x-engine-asset')) {
        e.preventDefault();
        target.style.outline = '1px solid rgba(124,140,255,0.65)';
      }
    });
    target.addEventListener('dragleave', () => {
      target.style.outline = '1px solid rgba(124,140,255,0.22)';
    });
    target.addEventListener('drop', (e) => {
      target.style.outline = '1px solid rgba(124,140,255,0.22)';
      const raw = e.dataTransfer?.getData('application/x-engine-asset');
      if (!raw) return;
      e.preventDefault();
      try {
        const asset = JSON.parse(raw) as AssetEntry;
        this._instantiateAsset(asset);
      } catch {
        this.statusBar.setLeft('Unable to drop asset into scene');
      }
    });
  }

  private _instantiateAsset(asset: AssetEntry): void {
    switch (asset.type) {
      case 'mesh':
      case 'model':
        if (asset.handle !== undefined) {
          const id = this._spawnRenderable(asset.handle, undefined, asset.name);
          this.statusBar.setLeft(`Instanced ${asset.name} as Entity #${id}`);
          return;
        }
        break;
      case 'material': {
        if (asset.handle === undefined) break;
        const selected = this.selection.first;
        if (selected !== null && this.engine.world.has(selected)) {
          if (!this.engine.world.hasComponent(selected, MaterialRef)) {
            this.engine.world.addComponent(selected, MaterialRef);
          }
          this.engine.world.setField(selected, MaterialRef, 'handle', asset.handle);
          this.statusBar.setLeft(`Applied ${asset.name} to Entity #${selected}`);
        } else {
          const id = this._spawnRenderable(undefined, asset.handle, asset.name);
          this.statusBar.setLeft(`Created material preview for ${asset.name} as Entity #${id}`);
        }
        return;
      }
      case 'audio':
        this.statusBar.setLeft(`Audio asset ${asset.name} is imported but not placeable in the scene yet`);
        return;
      default:
        break;
    }
    this.statusBar.setLeft(`Asset ${asset.name} is not ready for viewport drop yet`);
  }

  private _spawnRenderable(meshHandle?: number, materialHandle?: number, label = 'Asset'): number {
    const world = this.engine.world;
    const defaultMat = materialHandle ?? this.engine.createMaterial().handle;
    const center = this.viewport.camera.target;
    const id = world.spawn().id;
    world.addComponent(id, LocalTransform, {
      px: center[0],
      py: center[1] + 1,
      pz: center[2],
      rotY: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
    });
    world.addComponent(id, WorldMatrix, {
      m0: 1, m1: 0, m2: 0, m3: 0,
      m4: 0, m5: 1, m6: 0, m7: 0,
      m8: 0, m9: 0, m10: 1, m11: 0,
      m12: 0, m13: 0, m14: 0, m15: 1,
    });
    world.addComponent(id, Visible);
    if (meshHandle !== undefined) {
      world.addComponent(id, MeshRef);
      world.setField(id, MeshRef, 'handle', meshHandle);
    }
    world.addComponent(id, MaterialRef);
    world.setField(id, MaterialRef, 'handle', defaultMat);
    this.selection.select(id);
    this.assetBrowser.refresh();
    this.statusBar.setCenter(`${label} ready`);
    return id;
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
          case 'k':
            e.preventDefault();
            this._openCommandPalette();
            return;
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
    this.commandPalette.destroy();
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
