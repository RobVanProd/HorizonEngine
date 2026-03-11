import type { Editor } from './editor.js';
import type { CommandRouter } from '@engine/ai';
import type { ViewportOverlayId } from './viewport/viewport.js';

/**
 * Register editor-specific AI commands onto a CommandRouter.
 */
export function registerEditorCommands(router: CommandRouter, editor: Editor): void {
  router.register({
    action: 'editor.selectEntity',
    description: 'Select an entity by ID in the editor',
    params: { entityId: { type: 'number', required: true, description: 'Entity ID to select' } },
  }, (params) => {
    const entityId = Number(params['entityId']);
    editor.selection.select(entityId);
    return { ok: true, data: { selected: entityId } };
  });

  router.register({
    action: 'editor.clearSelection',
    description: 'Clear the current selection',
    params: {},
  }, () => {
    editor.selection.clear();
    return { ok: true };
  });

  router.register({
    action: 'editor.getSelection',
    description: 'Get the list of currently selected entity IDs',
    params: {},
  }, () => {
    return { ok: true, data: { ids: [...editor.selection.ids] } };
  });

  router.register({
    action: 'editor.setTool',
    description: 'Set the active transform tool',
    params: { tool: { type: 'string', required: true, description: 'Tool: select, translate, rotate, scale' } },
  }, (params) => {
    const tool = String(params['tool'] ?? '');
    const valid = ['select', 'translate', 'rotate', 'scale'];
    if (!valid.includes(tool)) return { ok: false, error: `Invalid tool. Use: ${valid.join(', ')}` };
    editor.toolbar.setTool(tool as any);
    return { ok: true, data: { tool } };
  });

  router.register({
    action: 'editor.setCamera',
    description: 'Set the editor camera target, distance, and angles',
    params: {
      targetX: { type: 'number', description: 'Camera target X' },
      targetY: { type: 'number', description: 'Camera target Y' },
      targetZ: { type: 'number', description: 'Camera target Z' },
      distance: { type: 'number', description: 'Camera distance from target' },
      yaw: { type: 'number', description: 'Camera yaw in radians' },
      pitch: { type: 'number', description: 'Camera pitch in radians' },
    },
  }, (params) => {
    const cam = editor.viewport.camera;
    if (params['targetX'] !== undefined) cam.target[0] = Number(params['targetX']);
    if (params['targetY'] !== undefined) cam.target[1] = Number(params['targetY']);
    if (params['targetZ'] !== undefined) cam.target[2] = Number(params['targetZ']);
    if (params['distance'] !== undefined) cam.distance = Number(params['distance']);
    if (params['yaw'] !== undefined) cam.yaw = Number(params['yaw']);
    if (params['pitch'] !== undefined) cam.pitch = Number(params['pitch']);
    return { ok: true };
  });

  router.register({
    action: 'editor.setViewPreset',
    description: 'Set the viewport to a camera preset',
    params: { preset: { type: 'string', required: true, description: 'Preset: perspective, top, front, right' } },
  }, (params) => {
    const preset = String(params['preset'] ?? '');
    const valid = ['perspective', 'top', 'front', 'right'];
    if (!valid.includes(preset)) return { ok: false, error: `Invalid preset. Use: ${valid.join(', ')}` };
    editor.viewport.camera.setPreset(preset as any);
    return { ok: true };
  });

  router.register({
    action: 'editor.toggleGrid',
    description: 'Toggle the viewport grid visibility',
    params: {},
  }, () => {
    editor.viewport.showGrid = !editor.viewport.showGrid;
    return { ok: true, data: { gridVisible: editor.viewport.showGrid } };
  });

  router.register({
    action: 'editor.undo',
    description: 'Undo the last action',
    params: {},
  }, () => {
    if (!editor.undoStack.canUndo) return { ok: false, error: 'Nothing to undo' };
    editor.undoStack.undo();
    return { ok: true };
  });

  router.register({
    action: 'editor.redo',
    description: 'Redo the last undone action',
    params: {},
  }, () => {
    if (!editor.undoStack.canRedo) return { ok: false, error: 'Nothing to redo' };
    editor.undoStack.redo();
    return { ok: true };
  });

  router.register({
    action: 'editor.saveScene',
    description: 'Serialize the current scene to JSON',
    params: { name: { type: 'string', description: 'Scene name (default: scene)' } },
  }, (params) => {
    const json = editor.serializer.toJSON(String(params['name'] ?? 'scene'));
    return { ok: true, data: { json } };
  });

  router.register({
    action: 'editor.loadScene',
    description: 'Load a scene from JSON',
    params: { json: { type: 'string', required: true, description: 'Scene JSON string' } },
  }, (params) => {
    try {
      editor.serializer.fromJSON(String(params['json'] ?? ''));
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  router.register({
    action: 'editor.addPrimitive',
    description: 'Add a primitive shape to the scene',
    params: { type: { type: 'string', required: true, description: 'Shape: sphere, plane, cube' } },
  }, (params) => {
    const type = String(params['type'] ?? '');
    const valid = ['sphere', 'plane', 'cube'];
    if (!valid.includes(type)) return { ok: false, error: `Invalid type. Use: ${valid.join(', ')}` };
    // Trigger the editor's add primitive flow
    (editor as any)._addPrimitive(type);
    return { ok: true };
  });

  router.register({
    action: 'editor.focusSelected',
    description: 'Focus the camera on the currently selected entity',
    params: {},
  }, () => {
    (editor as any)._focusSelected();
    return { ok: true };
  });

  router.register({
    action: 'editor.refreshAssets',
    description: 'Refresh the asset browser to reflect current engine state',
    params: {},
  }, () => {
    editor.assetBrowser.refresh();
    return { ok: true };
  });

  router.register({
    action: 'editor.getViewportState',
    description: 'Inspect the current viewport camera, overlays, and selection state',
    params: {},
  }, () => {
    return { ok: true, data: editor.viewport.inspectState() };
  });

  router.register({
    action: 'editor.toggleOverlay',
    description: 'Toggle a viewport debug overlay',
    params: {
      overlay: { type: 'string', required: true, description: 'Overlay: bounds or audio' },
      enabled: { type: 'boolean', description: 'Optional explicit on/off state' },
    },
  }, (params) => {
    const overlay = String(params['overlay'] ?? '') as ViewportOverlayId;
    if (overlay !== 'bounds' && overlay !== 'audio') {
      return { ok: false, error: 'Invalid overlay. Use: bounds, audio' };
    }
    const enabled = params['enabled'];
    const state = enabled === undefined
      ? editor.viewport.toggleOverlay(overlay)
      : (editor.viewport.setOverlay(overlay, Boolean(enabled)), editor.viewport.getOverlay(overlay));
    return { ok: true, data: { overlay, enabled: state } };
  });

  router.register({
    action: 'editor.pickViewport',
    description: 'Pick an entity in the viewport at screen coordinates',
    params: {
      x: { type: 'number', required: true, description: 'Viewport-local X coordinate in CSS pixels' },
      y: { type: 'number', required: true, description: 'Viewport-local Y coordinate in CSS pixels' },
      additive: { type: 'boolean', description: 'Whether to add to the current selection' },
    },
  }, async (params) => {
    await editor.viewport.pickScreenPoint(
      Number(params['x']),
      Number(params['y']),
      Boolean(params['additive'] ?? false),
    );
    return { ok: true, data: { selection: [...editor.selection.ids] } };
  });
}
