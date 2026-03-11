import type { Command, CommandResult, CommandHandler, CommandSchema, ToolDefinition, ParamDef } from './types.js';

/**
 * Routes JSON commands to registered handlers.
 * Auto-generates LLM-compatible tool definitions from schemas.
 */
export class CommandRouter {
  private _handlers = new Map<string, CommandHandler>();
  private _schemas = new Map<string, CommandSchema>();

  /**
   * Register a command handler with its schema.
   */
  register(schema: CommandSchema, handler: CommandHandler): void {
    this._handlers.set(schema.action, handler);
    this._schemas.set(schema.action, schema);
  }

  /**
   * Unregister a command by action name.
   */
  unregister(action: string): void {
    this._handlers.delete(action);
    this._schemas.delete(action);
  }

  /**
   * Execute a single command.
   */
  async execute(cmd: Command): Promise<CommandResult> {
    const handler = this._handlers.get(cmd.action);
    if (!handler) {
      return { id: cmd.id, ok: false, error: `Unknown action: ${cmd.action}` };
    }
    try {
      const result = await handler(cmd.params);
      return { ...result, id: cmd.id };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { id: cmd.id, ok: false, error: msg };
    }
  }

  /**
   * Execute a batch of commands sequentially.
   */
  async executeBatch(cmds: Command[]): Promise<CommandResult[]> {
    const results: CommandResult[] = [];
    for (const cmd of cmds) {
      results.push(await this.execute(cmd));
    }
    return results;
  }

  /**
   * Get all registered action names.
   */
  getActions(): string[] {
    return Array.from(this._handlers.keys()).sort();
  }

  /**
   * Get all registered command schemas.
   */
  getSchemas(): CommandSchema[] {
    return Array.from(this._schemas.values());
  }

  /**
   * Generate OpenAI-compatible tool definitions for all registered commands.
   */
  getToolDefinitions(): ToolDefinition[] {
    return this.getSchemas().map(s => schemaToTool(s));
  }

  /**
   * Generate Anthropic-compatible tool definitions (same shape).
   */
  getAnthropicTools(): ToolDefinition[] {
    return this.getToolDefinitions();
  }

  hasAction(action: string): boolean {
    return this._handlers.has(action);
  }

  get actionCount(): number {
    return this._handlers.size;
  }
}

function paramDefToJsonSchema(p: ParamDef): Record<string, unknown> {
  const out: Record<string, unknown> = { type: p.type };
  if (p.description) out['description'] = p.description;
  if (p.enum) out['enum'] = p.enum;
  if (p.default !== undefined) out['default'] = p.default;
  if (p.type === 'array' && p.items) {
    out['items'] = paramDefToJsonSchema(p.items);
  }
  if (p.type === 'object' && p.properties) {
    const props: Record<string, unknown> = {};
    const req: string[] = [];
    for (const [k, v] of Object.entries(p.properties)) {
      props[k] = paramDefToJsonSchema(v);
      if (v.required) req.push(k);
    }
    out['properties'] = props;
    if (req.length > 0) out['required'] = req;
  }
  return out;
}

function schemaToTool(schema: CommandSchema): ToolDefinition {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, paramDef] of Object.entries(schema.params)) {
    properties[key] = paramDefToJsonSchema(paramDef);
    if (paramDef.required) required.push(key);
  }

  return {
    type: 'function',
    function: {
      name: schema.action,
      description: schema.description,
      parameters: {
        type: 'object',
        properties,
        required,
      },
    },
  };
}
