import type { Particle } from './runtime.js';

const INSTANCE_FLOATS = 8;
const INSTANCE_BYTES = INSTANCE_FLOATS * 4;
const MAX_PARTICLES = 8192;

const PARTICLE_SHADER = /* wgsl */`
struct Camera {
  viewProj: mat4x4f,
  right: vec4f,
  up: vec4f,
}

struct Instance {
  position: vec3f,
  size: f32,
  color: vec4f,
}

@group(0) @binding(0) var<uniform> camera: Camera;

struct VOut {
  @builtin(position) clipPos: vec4f,
  @location(0) color: vec4f,
  @location(1) uv: vec2f,
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32, @location(0) position: vec3f, @location(1) size: f32, @location(2) color: vec4f) -> VOut {
  var quad = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f( 1.0, -1.0),
    vec2f( 1.0,  1.0),
    vec2f(-1.0, -1.0),
    vec2f( 1.0,  1.0),
    vec2f(-1.0,  1.0),
  );
  var uvMap = array<vec2f, 6>(
    vec2f(0.0, 1.0),
    vec2f(1.0, 1.0),
    vec2f(1.0, 0.0),
    vec2f(0.0, 1.0),
    vec2f(1.0, 0.0),
    vec2f(0.0, 0.0),
  );
  let corner = quad[vertexIndex] * size;
  let worldPos = position + camera.right.xyz * corner.x + camera.up.xyz * corner.y;
  var out: VOut;
  out.clipPos = camera.viewProj * vec4f(worldPos, 1.0);
  out.color = color;
  out.uv = uvMap[vertexIndex];
  return out;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4f {
  let centered = in.uv * 2.0 - 1.0;
  let falloff = clamp(1.0 - dot(centered, centered), 0.0, 1.0);
  return vec4f(in.color.rgb, in.color.a * falloff);
}
`;

export class ParticleRenderer {
  private _device: GPUDevice;
  private _uniformBuffer: GPUBuffer;
  private _instanceBuffer: GPUBuffer;
  private _uniformBindGroup: GPUBindGroup;
  private _pipelineAlpha: GPURenderPipeline;
  private _pipelineAdditive: GPURenderPipeline;

  constructor(device: GPUDevice, format: GPUTextureFormat) {
    this._device = device;
    this._uniformBuffer = device.createBuffer({
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._instanceBuffer = device.createBuffer({
      size: MAX_PARTICLES * INSTANCE_BYTES,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    const shader = device.createShaderModule({ code: PARTICLE_SHADER, label: 'particle-shader' });
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
    });
    this._uniformBindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this._uniformBuffer } }],
    });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

    this._pipelineAlpha = this._createPipeline(layout, shader, format, false);
    this._pipelineAdditive = this._createPipeline(layout, shader, format, true);
  }

  render(
    pass: GPURenderPassEncoder,
    particles: Particle[],
    viewProj: Float32Array,
    cameraRight: [number, number, number],
    cameraUp: [number, number, number],
    additive: boolean,
  ): void {
    if (particles.length === 0) return;
    const count = Math.min(particles.length, MAX_PARTICLES);
    const instanceData = new Float32Array(count * INSTANCE_FLOATS);
    for (let i = 0; i < count; i++) {
      const particle = particles[i]!;
      const base = i * INSTANCE_FLOATS;
      instanceData[base] = particle.px;
      instanceData[base + 1] = particle.py;
      instanceData[base + 2] = particle.pz;
      instanceData[base + 3] = particle.size;
      instanceData[base + 4] = particle.color[0];
      instanceData[base + 5] = particle.color[1];
      instanceData[base + 6] = particle.color[2];
      instanceData[base + 7] = particle.color[3] * (1 - particle.age / particle.life);
    }

    const uniformData = new Float32Array(24);
    uniformData.set(viewProj, 0);
    uniformData.set([cameraRight[0], cameraRight[1], cameraRight[2], 0], 16);
    uniformData.set([cameraUp[0], cameraUp[1], cameraUp[2], 0], 20);
    this._device.queue.writeBuffer(this._uniformBuffer, 0, uniformData);
    this._device.queue.writeBuffer(this._instanceBuffer, 0, instanceData);

    pass.setPipeline(additive ? this._pipelineAdditive : this._pipelineAlpha);
    pass.setBindGroup(0, this._uniformBindGroup);
    pass.setVertexBuffer(0, this._instanceBuffer);
    pass.draw(6, count);
  }

  destroy(): void {
    this._uniformBuffer.destroy();
    this._instanceBuffer.destroy();
  }

  private _createPipeline(
    layout: GPUPipelineLayout,
    shader: GPUShaderModule,
    format: GPUTextureFormat,
    additive: boolean,
  ): GPURenderPipeline {
    return this._device.createRenderPipeline({
      layout,
      vertex: {
        module: shader,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: INSTANCE_BYTES,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32' },
            { shaderLocation: 2, offset: 16, format: 'float32x4' },
          ],
        }],
      },
      fragment: {
        module: shader,
        entryPoint: 'fs_main',
        targets: [{
          format,
          blend: additive
            ? {
              color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            }
            : {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
      },
    });
  }
}
