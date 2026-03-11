import type { Archetype } from './archetype.js';
import type { ComponentDef } from './component.js';
import { componentMask } from './component.js';

/**
 * A Query matches all archetypes that contain a required set of components.
 * Queries cache their matched archetypes and must be notified when new archetypes are created.
 */
export class Query {
  readonly requiredMask: bigint;
  readonly required: readonly ComponentDef[];
  private _matched: Archetype[] = [];
  private _version = -1;

  constructor(required: ComponentDef[]) {
    this.required = required;
    this.requiredMask = componentMask(required);
  }

  /**
   * Returns all archetypes that match this query. Called by World when iterating.
   */
  get archetypes(): readonly Archetype[] {
    return this._matched;
  }

  /**
   * Test and potentially add an archetype to this query's match list.
   */
  tryMatch(archetype: Archetype): boolean {
    if ((archetype.mask & this.requiredMask) === this.requiredMask) {
      this._matched.push(archetype);
      return true;
    }
    return false;
  }

  /**
   * Iterate over all matching archetypes, calling fn with each archetype and its entity count.
   * This is the primary system iteration API.
   */
  each(fn: (archetype: Archetype, count: number) => void): void {
    for (let i = 0; i < this._matched.length; i++) {
      const arch = this._matched[i]!;
      if (arch.count > 0) {
        fn(arch, arch.count);
      }
    }
  }

  /**
   * Count total entities across all matched archetypes.
   */
  get entityCount(): number {
    let total = 0;
    for (const arch of this._matched) total += arch.count;
    return total;
  }
}
