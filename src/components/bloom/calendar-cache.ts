export type CalendarEntry<T> = {data?: T; error?: unknown; loading: boolean; etag?: string};
export type CalendarFetch<T> = (key: string, etag: string | undefined, signal: AbortSignal) => Promise<{data?: T; etag?: string; unchanged?: boolean}>;
/** Memory only, owned by one mounted identity/role scope. Never persisted across sign-in. */
export class CalendarCache<T> {
  private entries = new Map<string, CalendarEntry<T>>();
  private pending = new Map<string, AbortController>();
  private listeners = new Set<() => void>();
  private fetcher: CalendarFetch<T>;
  constructor(fetcher: CalendarFetch<T>) { this.fetcher = fetcher; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  entry(key: string): CalendarEntry<T> {
    if (!this.entries.has(key)) this.entries.set(key,{loading:true});
    return this.entries.get(key)!;
  }
  private emit() { this.listeners.forEach(listener=>listener()); }
  async load(key: string, check = false) {
    const before = this.entry(key);
    if(this.pending.has(key) || (!check && before.data !== undefined)) return;
    const controller=new AbortController();this.pending.set(key,controller);
    try {
      const result=await this.fetcher(key,before.etag,controller.signal);
      if(controller.signal.aborted)return;
      if(result.unchanged) {
        if(before.data === undefined) throw new Error('Calendar validator without cached data');
        if(before.error) { this.entries.set(key,{...before,error:undefined,loading:false});this.emit(); }
      } else {
        this.entries.set(key,{data:result.data,etag:result.etag,loading:false});this.emit();
      }
    } catch(error) {
      if(controller.signal.aborted)return;
      // Drop data on any failure; an expired or revoked identity must not display cached data.
      if (typeof error === 'object' && error !== null && 'code' in error && ['UNAUTHENTICATED','FORBIDDEN'].includes(String(error.code))) {
        this.pending.forEach((pending,other)=>{if(other!==key)pending.abort();});
        for(const cached of this.entries.keys())this.entries.set(cached,{error,loading:false});
      } else this.entries.set(key,{error,loading:false});
      this.emit();
    } finally { if(this.pending.get(key)===controller)this.pending.delete(key); }
    // Bound memory to 24 visited months, excluding requests still in flight.
    if(this.entries.size>24)for(const candidate of this.entries.keys()) {
      if(candidate!==key&&!this.pending.has(candidate)){this.entries.delete(candidate);break;}
    }
  }
  check = () => { for(const key of this.entries.keys())void this.load(key,true); };
  dispose() { this.pending.forEach(c=>c.abort());this.pending.clear(); }
}
