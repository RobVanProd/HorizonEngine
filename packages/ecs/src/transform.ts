import { FieldType } from '@engine/memory';
import { defineComponent } from './component.js';
import type { World } from './world.js';
import type { Query } from './query.js';

/**
 * Local-space transform: position, euler Y rotation, and uniform scale.
 * Full quaternion rotation can be added later; Y-rotation covers Phase 2 needs.
 */
export const LocalTransform = defineComponent('LocalTransform', {
  px: FieldType.F32,
  py: FieldType.F32,
  pz: FieldType.F32,
  rotY: FieldType.F32,
  scaleX: FieldType.F32,
  scaleY: FieldType.F32,
  scaleZ: FieldType.F32,
});

/**
 * Computed world-space 4x4 matrix (column-major, 16 floats stored as 4 vec4 columns).
 * Written by the transform propagation system, read by rendering.
 */
export const WorldMatrix = defineComponent('WorldMatrix', {
  m0: FieldType.F32,
  m1: FieldType.F32,
  m2: FieldType.F32,
  m3: FieldType.F32,
  m4: FieldType.F32,
  m5: FieldType.F32,
  m6: FieldType.F32,
  m7: FieldType.F32,
  m8: FieldType.F32,
  m9: FieldType.F32,
  m10: FieldType.F32,
  m11: FieldType.F32,
  m12: FieldType.F32,
  m13: FieldType.F32,
  m14: FieldType.F32,
  m15: FieldType.F32,
});

/**
 * Parent entity reference. Entity ID of 0 means "no parent" (root).
 */
export const Parent = defineComponent('Parent', {
  entity: FieldType.U32,
});

/**
 * Depth in the hierarchy tree. Roots have depth 0.
 * Used to sort propagation order (parents before children).
 */
export const HierarchyDepth = defineComponent('HierarchyDepth', {
  depth: FieldType.U32,
});

/**
 * Compute local-to-world matrix from LocalTransform fields.
 * Writes result into a 16-element buffer (column-major).
 */
function localToMatrix(
  px: number, py: number, pz: number,
  rotY: number,
  sx: number, sy: number, sz: number,
  out: Float32Array, offset: number,
): void {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);

  // Column 0
  out[offset + 0] = c * sx;
  out[offset + 1] = 0;
  out[offset + 2] = s * sx;
  out[offset + 3] = 0;
  // Column 1
  out[offset + 4] = 0;
  out[offset + 5] = sy;
  out[offset + 6] = 0;
  out[offset + 7] = 0;
  // Column 2
  out[offset + 8] = -s * sz;
  out[offset + 9] = 0;
  out[offset + 10] = c * sz;
  out[offset + 11] = 0;
  // Column 3
  out[offset + 12] = px;
  out[offset + 13] = py;
  out[offset + 14] = pz;
  out[offset + 15] = 1;
}

function multiplyMat4(a: Float32Array, aOff: number, b: Float32Array, bOff: number, out: Float32Array, oOff: number): void {
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[aOff + k * 4 + j]! * b[bOff + i * 4 + k]!;
      }
      out[oOff + i * 4 + j] = sum;
    }
  }
}

const _tempLocal = new Float32Array(16);
const _tempResult = new Float32Array(16);

/**
 * Transform propagation system.
 *
 * For root entities (no parent or parent == 0): world matrix = local matrix.
 * For child entities: world matrix = parent world matrix * local matrix.
 *
 * This system requires entities to be processed in hierarchy order
 * (parents before children). It uses HierarchyDepth to sort.
 */
export function createTransformSystem(world: World): {
  rootQuery: Query;
  childQuery: Query;
  propagate: () => void;
} {
  const rootQuery = world.query(LocalTransform, WorldMatrix);
  const childQuery = world.query(LocalTransform, WorldMatrix, Parent, HierarchyDepth);

  function propagate(): void {
    // Pass 1: compute world matrices for all entities with LocalTransform
    // Roots first (entities without Parent component, or Parent.entity == 0)
    rootQuery.each((arch, count) => {
      const hasParent = arch.hasComponent(Parent);
      const lt_px = arch.getColumn(LocalTransform, 'px');
      const lt_py = arch.getColumn(LocalTransform, 'py');
      const lt_pz = arch.getColumn(LocalTransform, 'pz');
      const lt_rotY = arch.getColumn(LocalTransform, 'rotY');
      const lt_sx = arch.getColumn(LocalTransform, 'scaleX');
      const lt_sy = arch.getColumn(LocalTransform, 'scaleY');
      const lt_sz = arch.getColumn(LocalTransform, 'scaleZ');

      const wm = [
        arch.getColumn(WorldMatrix, 'm0'),
        arch.getColumn(WorldMatrix, 'm1'),
        arch.getColumn(WorldMatrix, 'm2'),
        arch.getColumn(WorldMatrix, 'm3'),
        arch.getColumn(WorldMatrix, 'm4'),
        arch.getColumn(WorldMatrix, 'm5'),
        arch.getColumn(WorldMatrix, 'm6'),
        arch.getColumn(WorldMatrix, 'm7'),
        arch.getColumn(WorldMatrix, 'm8'),
        arch.getColumn(WorldMatrix, 'm9'),
        arch.getColumn(WorldMatrix, 'm10'),
        arch.getColumn(WorldMatrix, 'm11'),
        arch.getColumn(WorldMatrix, 'm12'),
        arch.getColumn(WorldMatrix, 'm13'),
        arch.getColumn(WorldMatrix, 'm14'),
        arch.getColumn(WorldMatrix, 'm15'),
      ];

      if (!hasParent) {
        // Root entities: world = local
        for (let i = 0; i < count; i++) {
          localToMatrix(
            lt_px[i]!, lt_py[i]!, lt_pz[i]!,
            lt_rotY[i]!,
            lt_sx[i]!, lt_sy[i]!, lt_sz[i]!,
            _tempLocal, 0,
          );
          for (let c = 0; c < 16; c++) {
            wm[c]![i] = _tempLocal[c]!;
          }
        }
      }
    });

    // Pass 2: child entities (those with Parent component)
    // Read parent's WorldMatrix, multiply with local, write result
    childQuery.each((arch, count) => {
      const parentIds = arch.getColumn(Parent, 'entity');
      const lt_px = arch.getColumn(LocalTransform, 'px');
      const lt_py = arch.getColumn(LocalTransform, 'py');
      const lt_pz = arch.getColumn(LocalTransform, 'pz');
      const lt_rotY = arch.getColumn(LocalTransform, 'rotY');
      const lt_sx = arch.getColumn(LocalTransform, 'scaleX');
      const lt_sy = arch.getColumn(LocalTransform, 'scaleY');
      const lt_sz = arch.getColumn(LocalTransform, 'scaleZ');

      const wm = [
        arch.getColumn(WorldMatrix, 'm0'),
        arch.getColumn(WorldMatrix, 'm1'),
        arch.getColumn(WorldMatrix, 'm2'),
        arch.getColumn(WorldMatrix, 'm3'),
        arch.getColumn(WorldMatrix, 'm4'),
        arch.getColumn(WorldMatrix, 'm5'),
        arch.getColumn(WorldMatrix, 'm6'),
        arch.getColumn(WorldMatrix, 'm7'),
        arch.getColumn(WorldMatrix, 'm8'),
        arch.getColumn(WorldMatrix, 'm9'),
        arch.getColumn(WorldMatrix, 'm10'),
        arch.getColumn(WorldMatrix, 'm11'),
        arch.getColumn(WorldMatrix, 'm12'),
        arch.getColumn(WorldMatrix, 'm13'),
        arch.getColumn(WorldMatrix, 'm14'),
        arch.getColumn(WorldMatrix, 'm15'),
      ];

      const _parentWorld = new Float32Array(16);

      for (let i = 0; i < count; i++) {
        const parentId = parentIds[i]!;
        if (parentId === 0) {
          // No parent — treat as root
          localToMatrix(
            lt_px[i]!, lt_py[i]!, lt_pz[i]!,
            lt_rotY[i]!,
            lt_sx[i]!, lt_sy[i]!, lt_sz[i]!,
            _tempLocal, 0,
          );
          for (let c = 0; c < 16; c++) wm[c]![i] = _tempLocal[c]!;
          continue;
        }

        // Read parent world matrix
        for (let c = 0; c < 16; c++) {
          _parentWorld[c] = world.getField(parentId, WorldMatrix, `m${c}` as any);
        }

        localToMatrix(
          lt_px[i]!, lt_py[i]!, lt_pz[i]!,
          lt_rotY[i]!,
          lt_sx[i]!, lt_sy[i]!, lt_sz[i]!,
          _tempLocal, 0,
        );

        multiplyMat4(_parentWorld, 0, _tempLocal, 0, _tempResult, 0);

        for (let c = 0; c < 16; c++) wm[c]![i] = _tempResult[c]!;
      }
    });
  }

  return { rootQuery, childQuery, propagate };
}
