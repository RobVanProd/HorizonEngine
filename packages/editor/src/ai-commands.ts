import type { Editor } from './editor.js';

interface CommandRouter {
  register(name: string, schema: any, handler: (args: any) => any): void;
}

/**
 * Register editor-specific AI commands onto a CommandRouter.
 */
export function registerEditorCommands(router: CommandRouter, editor: Editor): void {
  router.register('editor.selectEntity', {
    description: 'Select an entity by ID in the editor',
    params: { entityId: { type: 'number', required: true, description: 'Entity ID to select' } },
  }, (args: { entityId: number }) => {
    editor.selection.select(args.entityId);
    return { ok: true, selected: args.entityId };
  });

  router.register('editor.clearSelection', {
    description: 'Clear the current selection',
    params: {},
  }, () => {
    editor.selection.clear();
    return { ok: true };
  });

  router.register('editor.getSelection', {
    description: 'Get the list of currently selected entity IDs',
    params: {},
  }, () => {
    return { ids: [...editor.selection.ids] };
  });

  router.register('editor.setTool', {
    description: 'Set the active transform tool',
    params: { tool: { type: 'string', required: true, description: 'Tool: select, translate, rotate, scale' } },
  }, (args: { tool: string }) => {
    const valid = ['select', 'translate', 'rotate', 'scale'];
    if (!valid.includes(args.tool)) return { error: `Invalid tool. Use: ${valid.join(', ')}` };
    editor.toolbar.setTool(args.tool as any);
    return { ok: true, tool: args.tool };
  });

  router.register('editor.setCamera', {
    description: 'Set the editor camera target, distance, and angles',
    params: {
      targetX: { type: 'number', description: 'Camera target X' },
      targetY: { type: 'number', description: 'Camera target Y' },
      targetZ: { type: 'number', description: 'Camera target Z' },
      distance: { type: 'number', description: 'Camera distance from target' },
      yaw: { type: 'number', description: 'Camera yaw in radians' },
      pitch: { type: 'number', description: 'Camera pitch in radians' },
    },
  }, (args: Record<string, number>) => {
    const cam = editor.viewport.camera;
    if (args.targetX !== undefined) cam.target[0] = args.targetX;
    if (args.targetY !== undefined) cam.target[1] = args.targetY;
    if (args.targetZ !== undefined) cam.target[2] = args.targetZ;
    if (args.distance !== undefined) cam.distance = args.distance;
    if (args.yaw !== undefined) cam.yaw = args.yaw;
    if (args.pitch !== undefined) cam.pitch = args.pitch;
    return { ok: true };
  });

  router.register('editor.setViewPreset', {
    description: 'Set the viewport to a camera preset',
    params: { preset: { type: 'string', required: true, description: 'Preset: perspective, top, front, right' } },
  }, (args: { preset: string }) => {
    const valid = ['perspective', 'top', 'front', 'right'];
    if (!valid.includes(args.preset)) return { error: `Invalid preset. Use: ${valid.join(', ')}` };
    editor.viewport.camera.setPreset(args.preset as any);
    return { ok: true };
  });

  router.register('editor.toggleGrid', {
    description: 'Toggle the viewport grid visibility',
    params: {},
  }, () => {
    editor.viewport.showGrid = !editor.viewport.showGrid;
    return { ok: true, gridVisible: editor.viewport.showGrid };
  });

  router.register('editor.undo', {
    description: 'Undo the last action',
    params: {},
  }, () => {
    if (!editor.undoStack.canUndo) return { error: 'Nothing to undo' };
    editor.undoStack.undo();
    return { ok: true };
  });

  router.register('editor.redo', {
    description: 'Redo the last undone action',
    params: {},
  }, () => {
    if (!editor.undoStack.canRedo) return { error: 'Nothing to redo' };
    editor.undoStack.redo();
    return { ok: true };
  });

  router.register('editor.saveScene', {
    description: 'Serialize the current scene to JSON',
    params: { name: { type: 'string', description: 'Scene name (default: scene)' } },
  }, (args: { name?: string }) => {
    const json = editor.serializer.toJSON(args.name ?? 'scene');
    return { ok: true, json };
  });

  router.register('editor.loadScene', {
    description: 'Load a scene from JSON',
    params: { json: { type: 'string', required: true, description: 'Scene JSON string' } },
  }, (args: { json: string }) => {
    try {
      editor.serializer.fromJSON(args.json);
      return { ok: true };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  router.register('editor.addPrimitive', {
    description: 'Add a primitive shape to the scene',
    params: { type: { type: 'string', required: true, description: 'Shape: sphere, plane, cube' } },
  }, (args: { type: string }) => {
    const valid = ['sphere', 'plane', 'cube'];
    if (!valid.includes(args.type)) return { error: `Invalid type. Use: ${valid.join(', ')}` };
    // Trigger the editor's add primitive flow
    (editor as any)._addPrimitive(args.type);
    return { ok: true };
  });

  router.register('editor.focusSelected', {
    description: 'Focus the camera on the currently selected entity',
    params: {},
  }, () => {
    (editor as any)._focusSelected();
    return { ok: true };
  });

  router.register('editor.refreshAssets', {
    description: 'Refresh the asset browser to reflect current engine state',
    params: {},
  }, () => {
    editor.assetBrowser.refresh();
    return { ok: true };
  });
}
