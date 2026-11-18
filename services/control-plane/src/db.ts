import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { uuid } from './crypto.ts';

type Value = string | number | null;

/**
 * Storage for the control plane. Local and test runs use SQLite through
 * node:sqlite (no native install on Windows). Every statement is plain SQL from
 * schema.sql, so a PostgreSQL adapter can implement this same interface.
 *
 * node:sqlite is synchronous, and Node runs one request handler at a time
 * between awaits, so a `transaction` body cannot interleave with another one.
 * That is what makes quota and device-slot counters race-safe here.
 */
export class Store {
  private readonly db: DatabaseSync;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  }

  get<T>(sql: string, ...params: Value[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  all<T>(sql: string, ...params: Value[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  run(sql: string, ...params: Value[]): number {
    return Number(this.db.prepare(sql).run(...params).changes);
  }

  /** Run synchronously inside BEGIN/COMMIT; anything thrown rolls back. Never pass an async function. */
  transaction<T>(body: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = body();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  setting(name: string): string | undefined {
    return this.get<{ value: string }>('SELECT value FROM settings WHERE name = ?', name)?.value;
  }

  setSetting(name: string, value: string): void {
    this.run('INSERT INTO settings (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value', name, value);
  }

  audit(actor: string, action: string, outcome: 'allowed' | 'denied', detail: string, nowMs: number): void {
    this.run('INSERT INTO audit_log (audit_id, at_ms, actor, action, outcome, detail) VALUES (?, ?, ?, ?, ?, ?)',
      uuid(), nowMs, actor, action, outcome, detail.slice(0, 500));
  }

  close(): void { this.db.close(); }
}
