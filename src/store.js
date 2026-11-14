// -----------------------------------------------------------------------------
// What /data keeps across restarts (/data/threema.json, mode 0600): the times
// of the sends of the last hour (the hourly limit), the pause after a rate
// limit or a server error, and the refused identity (8 bits of a salted hash,
// never the secret). No text, no recipient, no secret. Written through a
// temporary file (fsync), a rename and an fsync of the directory, one save
// after the other. A missing file is
// empty; a file that cannot be read (EACCES, EIO, too large) is NOT empty:
// never overwritten; one that does not parse is moved aside to `.bad` first.
// -----------------------------------------------------------------------------

import { open, readFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const MAX_BYTES = 1024 * 1024;

export class StoreUnreadable extends Error {
  constructor(reason) {
    super(`/data unreadable (${reason})`);
    this.name = 'StoreUnreadable';
  }
}

export class FileStore {
  constructor({
    dir = process.env.DATA_DIR || '/data',
    name = 'threema.json',
    fs = { open, readFile, rename },
  } = {}) {
    this.path = join(dir, name);
    this.fs = fs; // injected by the tests (the fsync calls are counted there)
    this.queue = Promise.resolve();
    this.next = null; // the save waiting behind the running one
  }

  /** The saved object; {} when the file does not exist; throws when it cannot be read. */
  async load() {
    let text;
    try {
      text = await this.fs.readFile(this.path, 'utf8');
    } catch (err) {
      if (err?.code === 'ENOENT') return {};
      throw new StoreUnreadable(err?.code ?? 'error');
    }
    if (text.length > MAX_BYTES) throw new StoreUnreadable('too large');
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // A torn or foreign file: set aside as `.bad` (kept for a look), never
      // overwritten in place; when it cannot be moved, it is unreadable.
      await this.setAside();
      return {};
    }
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
    // Valid JSON but not ours (an array, a number): set aside like a torn file.
    await this.setAside();
    return {};
  }

  /** Moves the file to `.bad`; when it cannot be moved, it is unreadable. */
  async setAside() {
    try {
      await this.fs.rename(this.path, `${this.path}.bad`);
    } catch (err) {
      throw new StoreUnreadable(err?.code ?? 'unparsable');
    }
  }

  /**
   * Saves after the previous save (the last one always lands last). At most
   * one write runs and one waits: a save asked while one waits replaces its
   * data and shares its outcome, so a /data that hangs never piles writes up.
   */
  save(data) {
    if (this.next) {
      this.next.data = data;
      return this.next.job;
    }
    const next = { data };
    this.next = next;
    const run = () => {
      if (this.next === next) this.next = null;
      return this.write(next.data);
    };
    next.job = this.queue.then(run, run);
    this.queue = next.job.catch(() => {});
    return next.job;
  }

  async write(data) {
    const tmp = `${this.path}.tmp`;
    const handle = await this.fs.open(tmp, 'w', 0o600);
    try {
      await handle.writeFile(JSON.stringify(data), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await this.fs.rename(tmp, this.path);
    // The rename itself reaches the disk only with the directory.
    const dir = await this.fs.open(dirname(this.path), 'r');
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  }

  flush() {
    return this.queue;
  }
}

/** The same in memory (tests): `fail`, `hang` and `unreadable` simulate a bad volume. */
export function createMemoryStore(initial = {}) {
  const store = {
    data: structuredClone(initial),
    saves: 0,
    loads: 0,
    unreadable: false,
    hang: false,
    failSave: false,
    async load() {
      store.loads += 1;
      if (store.hang) return new Promise(() => {});
      if (store.unreadable) throw new StoreUnreadable('EIO');
      return structuredClone(store.data);
    },
    async save(next) {
      if (store.failSave) throw new Error('EROFS');
      store.saves += 1;
      store.data = structuredClone(next);
    },
    flush: async () => {},
  };
  return store;
}
