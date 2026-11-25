import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export function hashClaimToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken.trim().toUpperCase()).digest('hex');
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

export function initDatabase(dbPath: string): Database.Database {
  const resolved = path.resolve(dbPath);
  const dir = path.dirname(resolved);
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      handle TEXT UNIQUE,
      password_hash TEXT,
      is_shadow INTEGER NOT NULL DEFAULT 0 CHECK (is_shadow IN (0, 1)),
      claim_token_hash TEXT,
      claim_token_expires_at TEXT,
      claimed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      currency_code TEXT NOT NULL DEFAULT 'PKR',
      icon_key TEXT NOT NULL DEFAULT 'home',
      accent_theme TEXT NOT NULL DEFAULT 'emerald',
      quiet_hours_start INTEGER NOT NULL DEFAULT 22 CHECK (quiet_hours_start BETWEEN 0 AND 23),
      quiet_hours_end INTEGER NOT NULL DEFAULT 8 CHECK (quiet_hours_end BETWEEN 0 AND 23),
      reminder_cooldown_hours INTEGER NOT NULL DEFAULT 12 CHECK (reminder_cooldown_hours BETWEEN 1 AND 168),
      created_by_user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('HOST', 'ADMIN', 'MEMBER')),
      snoozed_until TEXT,
      last_reminded_at TEXT,
      joined_at TEXT NOT NULL,
      UNIQUE (group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      paid_by_member_id INTEGER NOT NULL REFERENCES group_members(id),
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      total_minor INTEGER NOT NULL CHECK (total_minor > 0),
      split_mode TEXT NOT NULL CHECK (split_mode IN ('EQUAL', 'CUSTOM')),
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'VOIDED')),
      void_reason TEXT,
      voided_by_member_id INTEGER REFERENCES group_members(id),
      receipt_path TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expense_splits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES group_members(id),
      amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
      UNIQUE (expense_id, member_id)
    );

    CREATE TABLE IF NOT EXISTS settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      from_member_id INTEGER NOT NULL REFERENCES group_members(id),
      to_member_id INTEGER NOT NULL REFERENCES group_members(id),
      amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
      status TEXT NOT NULL DEFAULT 'PENDING_CONFIRMATION' CHECK (
        status IN ('PENDING_CONFIRMATION', 'CONFIRMED', 'REJECTED', 'CANCELLED')
      ),
      note TEXT,
      receipt_path TEXT,
      rejection_reason TEXT,
      acted_by_member_id INTEGER REFERENCES group_members(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (from_member_id != to_member_id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      actor_member_id INTEGER REFERENCES group_members(id),
      action_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const groupCols = db.prepare(`PRAGMA table_info(groups)`).all() as Array<{ name: string }>;
  const colNames = new Set(groupCols.map((c) => c.name));
  if (!colNames.has('icon_key')) {
    db.exec(`ALTER TABLE groups ADD COLUMN icon_key TEXT NOT NULL DEFAULT 'home';`);
  }
  if (!colNames.has('accent_theme')) {
    db.exec(`ALTER TABLE groups ADD COLUMN accent_theme TEXT NOT NULL DEFAULT 'emerald';`);
  }

  return db;
}

export function appendAuditLog(
  db: Database.Database,
  params: {
    groupId: number;
    actorMemberId: number | null;
    actionType: string;
    entityType: string;
    entityId?: number | null;
    payload: Record<string, unknown>;
    createdAt?: string;
  },
): void {
  const now = params.createdAt ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO audit_logs (group_id, actor_member_id, action_type, entity_type, entity_id, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    params.groupId,
    params.actorMemberId,
    params.actionType,
    params.entityType,
    params.entityId ?? null,
    JSON.stringify(params.payload),
    now,
  );
}
