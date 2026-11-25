import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { computeEqualSplits } from './ledger.ts';
import type { VerificationProvider } from './verification.ts';

export function hashClaimToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
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

export function seedDemoData(
  db: Database.Database,
  verificationProvider: VerificationProvider,
): { groupId: number; demoShadowToken: string } {
  verificationProvider.clear();

  const now = new Date();
  const hoursAgo = (h: number) =>
    new Date(now.getTime() - h * 3600 * 1000).toISOString();

  const bilalRawToken = 'FS-BILAL-304';
  const bilalTokenRecord = verificationProvider.issueToken({
    purpose: 'SHADOW_CLAIM',
    recipientLabel: 'Bilal Ahmed (Shadow)',
    detail: 'Single-use claim token for Hostel Wing B · Room 304',
    ttlMinutes: 60 * 72,
    fixedToken: bilalRawToken,
  });

  const demoPassHash = hashPassword('demo1234');

  const tx = db.transaction(() => {
    db.exec(`
      DELETE FROM audit_logs;
      DELETE FROM settlements;
      DELETE FROM expense_splits;
      DELETE FROM expenses;
      DELETE FROM group_members;
      DELETE FROM groups;
      DELETE FROM users;
      DELETE FROM sqlite_sequence;
    `);

    const insertUser = db.prepare(
      `INSERT INTO users (name, handle, password_hash, is_shadow, claim_token_hash, claim_token_expires_at, claimed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const hamzaId = Number(
      insertUser.run(
        'Hamza Tariq',
        'hamza',
        demoPassHash,
        0,
        null,
        null,
        hoursAgo(120),
        hoursAgo(120),
      ).lastInsertRowid,
    );

    const ayeshaId = Number(
      insertUser.run(
        'Ayesha Khan',
        'ayesha',
        demoPassHash,
        0,
        null,
        null,
        hoursAgo(118),
        hoursAgo(118),
      ).lastInsertRowid,
    );

    const saadId = Number(
      insertUser.run(
        'Saad Mahmood',
        'saad',
        demoPassHash,
        0,
        null,
        null,
        hoursAgo(115),
        hoursAgo(115),
      ).lastInsertRowid,
    );

    const usmanId = Number(
      insertUser.run(
        'Usman Raza',
        'usman',
        demoPassHash,
        0,
        null,
        null,
        hoursAgo(110),
        hoursAgo(110),
      ).lastInsertRowid,
    );

    const bilalId = Number(
      insertUser.run(
        'Bilal Ahmed',
        null,
        null,
        1,
        hashClaimToken(bilalRawToken),
        bilalTokenRecord.expiresAt,
        null,
        hoursAgo(72),
      ).lastInsertRowid,
    );

    const groupId = Number(
      db
        .prepare(
          `INSERT INTO groups (name, currency_code, quiet_hours_start, quiet_hours_end, reminder_cooldown_hours, created_by_user_id, created_at)
           VALUES (?, 'PKR', 22, 8, 12, ?, ?)`,
        )
        .run('Hostel Wing B · Room 304', hamzaId, hoursAgo(120)).lastInsertRowid,
    );

    const insertMember = db.prepare(
      `INSERT INTO group_members (group_id, user_id, role, snoozed_until, last_reminded_at, joined_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    const hamzaMember = Number(
      insertMember.run(groupId, hamzaId, 'HOST', null, null, hoursAgo(120))
        .lastInsertRowid,
    );
    const ayeshaMember = Number(
      insertMember.run(groupId, ayeshaId, 'ADMIN', null, null, hoursAgo(118))
        .lastInsertRowid,
    );
    const saadMember = Number(
      insertMember.run(
        groupId,
        saadId,
        'MEMBER',
        null,
        hoursAgo(4),
        hoursAgo(115),
      ).lastInsertRowid,
    );
    const usmanMember = Number(
      insertMember.run(
        groupId,
        usmanId,
        'MEMBER',
        new Date(now.getTime() + 6 * 3600 * 1000).toISOString(),
        hoursAgo(20),
        hoursAgo(110),
      ).lastInsertRowid,
    );
    const bilalMember = Number(
      insertMember.run(groupId, bilalId, 'MEMBER', null, null, hoursAgo(72))
        .lastInsertRowid,
    );

    const insertExpense = db.prepare(
      `INSERT INTO expenses (group_id, paid_by_member_id, title, category, total_minor, split_mode, status, void_reason, voided_by_member_id, receipt_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertSplit = db.prepare(
      `INSERT INTO expense_splits (expense_id, member_id, amount_minor) VALUES (?, ?, ?)`,
    );

    // 1. PTCL Fiber Wi-Fi Monthly Bill: Rs. 4,500.00 (450,000 paisa) split equally across all 5
    const exp1 = Number(
      insertExpense.run(
        groupId,
        hamzaMember,
        'PTCL Fiber Wi-Fi Monthly Bill',
        'Utilities',
        450000,
        'EQUAL',
        'ACTIVE',
        null,
        null,
        null,
        hoursAgo(68),
      ).lastInsertRowid,
    );
    for (const sp of computeEqualSplits(450000, [
      hamzaMember,
      ayeshaMember,
      saadMember,
      usmanMember,
      bilalMember,
    ])) {
      insertSplit.run(exp1, sp.memberId, sp.amountMinor);
    }

    // 2. Late-Night Biryani & Chai: Rs. 2,851.00 (285,100 paisa) split equally across 4
    const exp2 = Number(
      insertExpense.run(
        groupId,
        ayeshaMember,
        'Late-Night Biryani & Quetta Chai',
        'Food',
        285100,
        'EQUAL',
        'ACTIVE',
        null,
        null,
        null,
        hoursAgo(46),
      ).lastInsertRowid,
    );
    for (const sp of computeEqualSplits(285100, [
      hamzaMember,
      ayeshaMember,
      saadMember,
      bilalMember,
    ])) {
      insertSplit.run(exp2, sp.memberId, sp.amountMinor);
    }

    // 3. UPS Battery & Fuse Maintenance: Rs. 1,600.00 (160,000 paisa) CUSTOM split
    const exp3 = Number(
      insertExpense.run(
        groupId,
        hamzaMember,
        'UPS Battery Water & Backup Fuse',
        'Room Maintenance',
        160000,
        'CUSTOM',
        'ACTIVE',
        null,
        null,
        null,
        hoursAgo(32),
      ).lastInsertRowid,
    );
    insertSplit.run(exp3, hamzaMember, 40000);
    insertSplit.run(exp3, ayeshaMember, 40000);
    insertSplit.run(exp3, saadMember, 45000);
    insertSplit.run(exp3, usmanMember, 35000);

    // 4. Mess Paratha & Chai Tab: Rs. 1,234.00 (123,400 paisa) across 3 -> shows deterministic 1-paisa remainder
    const exp4 = Number(
      insertExpense.run(
        groupId,
        saadMember,
        'Hostel Mess Chai & Paratha Tab',
        'Food',
        123400,
        'EQUAL',
        'ACTIVE',
        null,
        null,
        null,
        hoursAgo(18),
      ).lastInsertRowid,
    );
    for (const sp of computeEqualSplits(123400, [
      hamzaMember,
      saadMember,
      usmanMember,
    ])) {
      insertSplit.run(exp4, sp.memberId, sp.amountMinor);
    }

    // 5. Voided Expense example (stays visible in ledger history)
    const exp5 = Number(
      insertExpense.run(
        groupId,
        usmanMember,
        'Duplicate Electricity Meter Entry',
        'Utilities',
        320000,
        'EQUAL',
        'VOIDED',
        'Entered twice by mistake; kept original meter bill',
        hamzaMember,
        null,
        hoursAgo(14),
      ).lastInsertRowid,
    );
    for (const sp of computeEqualSplits(320000, [
      hamzaMember,
      ayeshaMember,
      saadMember,
      usmanMember,
    ])) {
      insertSplit.run(exp5, sp.memberId, sp.amountMinor);
    }

    const insertSettlement = db.prepare(
      `INSERT INTO settlements (group_id, from_member_id, to_member_id, amount_minor, status, note, receipt_path, rejection_reason, acted_by_member_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    // Confirmed partial settlement
    const st1 = Number(
      insertSettlement.run(
        groupId,
        saadMember,
        hamzaMember,
        50000,
        'CONFIRMED',
        'JazzCash partial transfer #JC-8841',
        null,
        null,
        hamzaMember,
        hoursAgo(12),
        hoursAgo(11),
      ).lastInsertRowid,
    );

    // Pending confirmation partial settlement
    const st2 = Number(
      insertSettlement.run(
        groupId,
        usmanMember,
        hamzaMember,
        40000,
        'PENDING_CONFIRMATION',
        'EasyPaisa sent — please verify receipt',
        null,
        null,
        null,
        hoursAgo(3),
        hoursAgo(3),
      ).lastInsertRowid,
    );

    // Rejected settlement example
    const st3 = Number(
      insertSettlement.run(
        groupId,
        saadMember,
        ayeshaMember,
        30000,
        'REJECTED',
        'Sent to old SadaPay IBAN',
        null,
        'Wrong account number — payment reversed back to sender',
        ayeshaMember,
        hoursAgo(9),
        hoursAgo(8),
      ).lastInsertRowid,
    );

    // Append-only audit logs
    appendAuditLog(db, {
      groupId,
      actorMemberId: hamzaMember,
      actionType: 'GROUP_CREATED',
      entityType: 'GROUP',
      entityId: groupId,
      payload: { name: 'Hostel Wing B · Room 304', currency: 'PKR' },
      createdAt: hoursAgo(120),
    });
    appendAuditLog(db, {
      groupId,
      actorMemberId: hamzaMember,
      actionType: 'SHADOW_MEMBER_INVITED',
      entityType: 'USER',
      entityId: bilalId,
      payload: { name: 'Bilal Ahmed', tokenExpiresAt: bilalTokenRecord.expiresAt },
      createdAt: hoursAgo(72),
    });
    appendAuditLog(db, {
      groupId,
      actorMemberId: hamzaMember,
      actionType: 'EXPENSE_CREATED',
      entityType: 'EXPENSE',
      entityId: exp1,
      payload: { title: 'PTCL Fiber Wi-Fi Monthly Bill', totalMinor: 450000 },
      createdAt: hoursAgo(68),
    });
    appendAuditLog(db, {
      groupId,
      actorMemberId: ayeshaMember,
      actionType: 'EXPENSE_CREATED',
      entityType: 'EXPENSE',
      entityId: exp2,
      payload: { title: 'Late-Night Biryani & Quetta Chai', totalMinor: 285100 },
      createdAt: hoursAgo(46),
    });
    appendAuditLog(db, {
      groupId,
      actorMemberId: hamzaMember,
      actionType: 'EXPENSE_CREATED',
      entityType: 'EXPENSE',
      entityId: exp3,
      payload: { title: 'UPS Battery Water & Backup Fuse', totalMinor: 160000 },
      createdAt: hoursAgo(32),
    });
    appendAuditLog(db, {
      groupId,
      actorMemberId: saadMember,
      actionType: 'EXPENSE_CREATED',
      entityType: 'EXPENSE',
      entityId: exp4,
      payload: { title: 'Hostel Mess Chai & Paratha Tab', totalMinor: 123400 },
      createdAt: hoursAgo(18),
    });
    appendAuditLog(db, {
      groupId,
      actorMemberId: hamzaMember,
      actionType: 'EXPENSE_VOIDED',
      entityType: 'EXPENSE',
      entityId: exp5,
      payload: {
        title: 'Duplicate Electricity Meter Entry',
        reason: 'Entered twice by mistake; kept original meter bill',
      },
      createdAt: hoursAgo(13),
    });
    appendAuditLog(db, {
      groupId,
      actorMemberId: hamzaMember,
      actionType: 'SETTLEMENT_CONFIRMED',
      entityType: 'SETTLEMENT',
      entityId: st1,
      payload: { fromMemberId: saadMember, toMemberId: hamzaMember, amountMinor: 50000 },
      createdAt: hoursAgo(11),
    });
    appendAuditLog(db, {
      groupId,
      actorMemberId: ayeshaMember,
      actionType: 'SETTLEMENT_REJECTED',
      entityType: 'SETTLEMENT',
      entityId: st3,
      payload: {
        fromMemberId: saadMember,
        toMemberId: ayeshaMember,
        amountMinor: 30000,
        reason: 'Wrong account number — payment reversed back to sender',
      },
      createdAt: hoursAgo(8),
    });
    appendAuditLog(db, {
      groupId,
      actorMemberId: usmanMember,
      actionType: 'SETTLEMENT_CREATED',
      entityType: 'SETTLEMENT',
      entityId: st2,
      payload: { fromMemberId: usmanMember, toMemberId: hamzaMember, amountMinor: 40000 },
      createdAt: hoursAgo(3),
    });

    return { groupId, demoShadowToken: bilalRawToken };
  });

  return tx();
}
