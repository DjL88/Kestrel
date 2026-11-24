/** Reference-counted demand across grid, filmstrip and the active photo.
 * A tile leaving either viewport removes only its own request. */
export class ThumbnailDemand {
  private counts = new Map<string, number>();
  private attempted = new Set<string>();
  retain(id: string): () => void {
    this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = this.counts.get(id) ?? 0;
      if (count <= 1) this.counts.delete(id);
      else this.counts.set(id, count - 1);
    };
  }
  has(id: string): boolean { return this.counts.has(id); }
  next(limit: number, activeId?: string | null): string[] {
    const ids = [...this.counts.keys()].filter(id => !this.attempted.has(id));
    if (activeId && ids.includes(activeId)) {
      ids.splice(ids.indexOf(activeId), 1);
      ids.unshift(activeId);
    }
    return ids.slice(0, limit);
  }
  mark(id: string): void { this.attempted.add(id); }
  invalidate(id: string): void { this.attempted.delete(id); }
}
