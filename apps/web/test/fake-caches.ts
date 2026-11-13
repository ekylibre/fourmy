/**
 * Cache Storage, service worker et estimation du stockage simulés : jsdom n'en
 * a pas. Juste ce qu'utilise la copie hors ligne (app/offline.ts).
 */
class FakeCache {
  readonly entries = new Map<string, Response>();
  private key(req: RequestInfo | URL) {
    return new URL(typeof req === "string" ? req : req instanceof URL ? req.href : req.url, globalThis.location.origin).href;
  }
  async match(req: RequestInfo | URL): Promise<Response | undefined> {
    return this.entries.get(this.key(req))?.clone();
  }
  async put(req: RequestInfo | URL, res: Response): Promise<void> {
    this.entries.set(this.key(req), new Response(await res.arrayBuffer(), { status: res.status, headers: res.headers }));
  }
  async delete(req: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(this.key(req));
  }
}

export class FakeCacheStorage {
  readonly stores = new Map<string, FakeCache>();
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache());
    return this.stores.get(name)! as unknown as Cache;
  }
  async has(name: string) {
    return this.stores.has(name);
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
  async keys() {
    return [...this.stores.keys()];
  }
  /** Entrées d'un cache (pour les assertions). */
  urls(name: string): string[] {
    return [...(this.stores.get(name)?.entries.keys() ?? [])];
  }
}

/** Installe les faux ; `quota` en octets (place libre = quota − usage). */
export function installOfflineFakes(opts: { quota?: number; usage?: number } = {}) {
  const storage = new FakeCacheStorage();
  Object.defineProperty(globalThis, "caches", { configurable: true, value: storage });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register: async () => ({}) } });
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: { estimate: async () => ({ quota: opts.quota ?? 1e9, usage: opts.usage ?? 0 }), persist: async () => true },
  });
  return {
    storage,
    uninstall() {
      Reflect.deleteProperty(globalThis, "caches");
      Reflect.deleteProperty(navigator, "serviceWorker");
      Reflect.deleteProperty(navigator, "storage");
    },
  };
}
