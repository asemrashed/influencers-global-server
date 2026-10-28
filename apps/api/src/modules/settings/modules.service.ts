import { MODULE_KEYS, type ModuleKey } from '@platform/shared-types';
import type { Db } from '../../db.js';
import { errors } from '../../lib/errors.js';

const TTL_MS = 2000;

/** Server-side feature toggles. A disabled module rejects its routes, it is not merely hidden. */
export class ModuleService {
  private cache: { at: number; map: Map<string, boolean> } | null = null;

  constructor(private readonly db: Db) {}

  async list(): Promise<{ key: ModuleKey; enabled: boolean }[]> {
    const map = await this.load();
    return MODULE_KEYS.map((key) => ({ key, enabled: map.get(key) ?? true }));
  }

  async isEnabled(key: ModuleKey): Promise<boolean> {
    return (await this.load()).get(key) ?? true;
  }

  async assertEnabled(key: ModuleKey): Promise<void> {
    if (!(await this.isEnabled(key))) throw errors.moduleDisabled(key);
  }

  invalidate(): void {
    this.cache = null;
  }

  private async load(): Promise<Map<string, boolean>> {
    if (this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache.map;
    const rows = await this.db.moduleToggle.findMany();
    const map = new Map(rows.map((r) => [r.key, r.enabled]));
    this.cache = { at: Date.now(), map };
    return map;
  }
}
