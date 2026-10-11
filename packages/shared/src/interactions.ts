/** Registry shared by authoring validation and runtime dispatchers. */
export class InteractionRegistry<T> {
  private handlers = new Map<string, T>();

  register(kind: string, handler: T): this {
    if (!kind.trim() || this.handlers.has(kind)) throw new Error(`Duplicate or empty interaction kind: ${kind}`);
    this.handlers.set(kind, handler);
    return this;
  }

  get(kind: string): T | undefined { return this.handlers.get(kind); }
  values(): IterableIterator<T> { return this.handlers.values(); }
}
