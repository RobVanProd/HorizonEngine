import { CommandRouter } from './command-router.js';
import { registerSceneCommands } from './scene-api.js';
import { registerAudioCommands } from './audio-commands.js';
import { registerMLCommands } from './ml-commands.js';
import { registerAdvancedCommands } from './advanced-commands.js';
import { registerDebugCommands } from './debug-commands.js';
import { registerWorldCommands } from './world-commands.js';
import { registerVfxCommands } from './vfx-commands.js';
import { registerGeometryCommands } from './geometry-commands.js';
import { registerControlPlaneCommands } from './control-plane/control-plane-api.js';
import { InferenceEngine } from './inference.js';
/**
 * Top-level AI integration facade.
 * Attach to an Engine to expose a structured command API for LLM and ML agents.
 */
export class EngineAI {
    router;
    engine;
    inference;
    _transports = [];
    constructor(engine) {
        this.engine = engine;
        this.router = new CommandRouter();
        this.inference = new InferenceEngine();
    }
    /**
     * Attach AI capabilities to an engine instance.
     * Registers built-in engine commands and returns the EngineAI facade.
     */
    static attach(engine) {
        const ai = new EngineAI(engine);
        ai._registerBuiltins();
        return ai;
    }
    /**
     * Execute a single command (the primary entry point for LLM agents).
     */
    async execute(cmd) {
        return this.router.execute(cmd);
    }
    /**
     * Execute a batch of commands.
     */
    async executeBatch(cmds) {
        return this.router.executeBatch(cmds);
    }
    /**
     * Get all available actions as LLM tool definitions.
     */
    getToolDefinitions() {
        return this.router.getToolDefinitions();
    }
    /**
     * Get tool definitions formatted for a specific provider.
     */
    getToolsForProvider(provider) {
        return this.router.getToolDefinitions();
    }
    /**
     * Get a compact schema listing (useful for system prompts).
     */
    getSchemaListing() {
        const schemas = this.router.getSchemas();
        const lines = schemas.map(s => {
            const params = Object.entries(s.params)
                .map(([k, v]) => `${k}${v.required ? '' : '?'}: ${v.type}`)
                .join(', ');
            return `  ${s.action}(${params}) — ${s.description}`;
        });
        return `Available commands (${schemas.length}):\n${lines.join('\n')}`;
    }
    /**
     * Register an additional command handler with its schema.
     */
    registerCommand(schema, handler) {
        this.router.register(schema, handler);
    }
    /**
     * Add a transport (WebSocket, Worker, etc.) for remote access.
     */
    addTransport(transport) {
        this._transports.push(transport);
        transport.onCommand((cmd) => this.execute(cmd));
    }
    /**
     * Start all registered transports.
     */
    async startTransports() {
        for (const t of this._transports) {
            await t.start();
        }
    }
    /**
     * Stop all transports and clean up.
     */
    destroy() {
        for (const t of this._transports) {
            t.stop();
        }
        this._transports = [];
        this.inference.destroy();
    }
    _registerBuiltins() {
        registerSceneCommands(this.router, this.engine);
        registerAudioCommands(this.router, this.engine);
        registerMLCommands(this.router, this.inference);
        registerAdvancedCommands(this.router, this.engine);
        registerDebugCommands(this.router, this.engine);
        registerWorldCommands(this.router, this.engine);
        registerVfxCommands(this.router, this.engine);
        registerGeometryCommands(this.router, this.engine);
        registerControlPlaneCommands(this.router, this.engine);
        this.router.register({
            action: 'engine.status',
            description: 'Get current engine status including entity count, system count, and renderer type',
            params: {},
        }, () => ({
            ok: true,
            data: {
                entityCount: this.engine.world.entityCount,
                archetypeCount: this.engine.world.archetypeCount,
                systemCount: this.engine.scheduler.getSystemCount(),
                meshCount: this.engine.meshes.size,
                materialCount: this.engine.materials.size,
                audioClipCount: this.engine.audioClips.size,
            },
        }));
        this.router.register({
            action: 'engine.getSchema',
            description: 'Get all available AI commands and their schemas as tool definitions',
            params: {
                format: { type: 'string', description: 'Output format', enum: ['tools', 'listing', 'schemas'], default: 'tools' },
            },
        }, (params) => {
            const format = params['format'] ?? 'tools';
            if (format === 'listing') {
                return { ok: true, data: this.getSchemaListing() };
            }
            if (format === 'schemas') {
                return { ok: true, data: this.router.getSchemas() };
            }
            return { ok: true, data: this.router.getToolDefinitions() };
        });
    }
}
//# sourceMappingURL=engine-ai.js.map
