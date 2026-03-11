/**
 * Editor Demo — Phase 6 validation.
 *
 * Demonstrates: Full editor UI with viewport, hierarchy, properties, asset browser,
 *               scene serialization, undo/redo, and object manipulation.
 */

import { Engine } from '@engine/core';
import {
  LocalTransform, Visible, MeshRef, MaterialRef,
  createTransformSystem,
} from '@engine/ecs';
import { Phase } from '@engine/scheduler';
import {
  GPUMesh, createSphere, createPlane, createTorus,
} from '@engine/renderer-webgpu';
import { Editor } from '@engine/editor';

async function main() {
  const engine = new Engine();

  await engine.initialize(
    { renderer: 'pbr' },
    {
      environment: { sunDirection: [0.5, 0.8, 0.3], sunIntensity: 40.0, cubemapSize: 512 },
      shadow: { resolution: 2048, frustumSize: 40 },
    },
  );

  // Register transform system
  const transformSys = createTransformSystem(engine.world);
  engine.scheduler.addSystem(Phase.TRANSFORM, () => transformSys.propagate(), 'transform');

  // Set up lighting
  engine.lighting = {
    direction: [-0.4, -0.7, -0.5],
    color: [1.0, 0.97, 0.9],
    intensity: 3.5,
    ambient: [0.02, 0.02, 0.03],
    envIntensity: 1.0,
  };

  // Create default meshes
  const sphereMesh = GPUMesh.create(engine.pbrRenderer.device, createSphere(1, 48, 24));
  const planeMesh  = GPUMesh.create(engine.pbrRenderer.device, createPlane(20, 20, 1, 1));
  const torusMesh  = GPUMesh.create(engine.pbrRenderer.device, createTorus(0.7, 0.25, 48, 24));

  const sphereHandle = engine.registerMesh(sphereMesh);
  const planeHandle  = engine.registerMesh(planeMesh);
  const torusHandle  = engine.registerMesh(torusMesh);

  // Create materials
  const { handle: groundMatH } = engine.createMaterial({
    albedo: [0.3, 0.3, 0.32, 1], roughness: 0.8, metallic: 0.0,
  });
  const { handle: redMetalH } = engine.createMaterial({
    albedo: [0.9, 0.15, 0.1, 1], roughness: 0.2, metallic: 1.0,
  });
  const { handle: blueRubberH } = engine.createMaterial({
    albedo: [0.1, 0.3, 0.9, 1], roughness: 0.7, metallic: 0.0,
  });
  const { handle: goldH } = engine.createMaterial({
    albedo: [1.0, 0.85, 0.3, 1], roughness: 0.3, metallic: 1.0,
  });
  const { handle: whiteH } = engine.createMaterial({
    albedo: [0.95, 0.95, 0.95, 1], roughness: 0.1, metallic: 0.0,
  });

  const world = engine.world;

  // Ground plane
  const ground = world.spawn().id;
  world.addComponent(ground, LocalTransform);
  world.addComponent(ground, Visible);
  world.addComponent(ground, MeshRef);
  world.addComponent(ground, MaterialRef);
  world.setField(ground, MeshRef, 'handle', planeHandle);
  world.setField(ground, MaterialRef, 'handle', groundMatH);

  // Spawn helper
  const spawnObj = (meshH: number, matH: number, x: number, y: number, z: number) => {
    const id = world.spawn().id;
    world.addComponent(id, LocalTransform);
    world.addComponent(id, Visible);
    world.addComponent(id, MeshRef);
    world.addComponent(id, MaterialRef);
    world.setField(id, LocalTransform, 'px', x);
    world.setField(id, LocalTransform, 'py', y);
    world.setField(id, LocalTransform, 'pz', z);
    world.setField(id, MeshRef, 'handle', meshH);
    world.setField(id, MaterialRef, 'handle', matH);
    return id;
  };

  // Row of spheres
  spawnObj(sphereHandle, redMetalH,    -4, 1,  0);
  spawnObj(sphereHandle, blueRubberH,  -2, 1,  0);
  spawnObj(sphereHandle, goldH,         0, 1,  0);
  spawnObj(sphereHandle, whiteH,        2, 1,  0);
  spawnObj(sphereHandle, redMetalH,     4, 1,  0);

  // Some tori
  spawnObj(torusHandle, goldH,       -3, 1, -3);
  spawnObj(torusHandle, blueRubberH,  0, 1, -3);
  spawnObj(torusHandle, redMetalH,    3, 1, -3);

  // Start engine
  engine.start();

  // Create the editor — this takes over the page layout
  const editor = Editor.create(engine);

  // Expose to console for debugging
  (window as any).editor = editor;
  (window as any).engine = engine;
}

main().catch(console.error);
