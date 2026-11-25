import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import {
  appendAuditLog,
  hashClaimToken,
  hashPassword,
  initDatabase,
  verifyPassword,
} from './server/db.ts';
import {
  computeEqualSplits,
  computeGroupBalances,
  evaluateReminderEligibility,
  formatMinorToPkr,
  parsePkrToMinor,
  validateCustomSplits,
} from './server/ledger.ts';
import type {
  ExpenseRecord,
  MemberRecord,
  Role,
  SettlementRecord,
  SplitRecord,
} from './server/ledger.ts';
import { createVerificationProvider } from './server/verification.ts';

dotenv.config();

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10) || 3000;
const DB_PATH = process.env.FAIRSHARE_DB_PATH || './data/fairshare.db';
const UPLOADS_DIR = path.resolve(process.env.FAIRSHARE_UPLOADS_DIR || './uploads');
const VERIFICATION_MODE = process.env.FAIRSHARE_VERIFICATION_MODE || 'dev_mock';
const SESSION_SECRET =
  process.env.FAIRSHARE_SESSION_SECRET &&
  process.env.FAIRSHARE_SESSION_SECRET.length >= 16
    ? process.env.FAIRSHARE_SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const verificationProvider = createVerificationProvider(VERIFICATION_MODE);
const db = initDatabase(DB_PATH);

interface SessionPayload {
  userId: number;
  exp: number;
}

interface AuthenticatedUser {
  userId: number;
  name: string;
  handle: string;
}

interface AuthenticatedRequest extends Request {
  authUser?: AuthenticatedUser;
  authMember?: MemberRecord & { groupId: number };
}

function signSessionToken(userId: number): string {
  const fullPayload: SessionPayload = {
    userId,
    exp: Date.now() + 14 * 24 * 3600 * 1000,
  };
  const body = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

function verifySessionToken(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(body)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as SessionPayload;
    if (!parsed || typeof parsed.userId !== 'number' || parsed.exp < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function loadUserById(userId: number): AuthenticatedUser | null {
  const row = db
    .prepare(
      `SELECT id AS userId, name, handle, is_shadow AS isShadow
       FROM users WHERE id = ?`,
    )
    .get(userId) as
    | { userId: number; name: string; handle: string | null; isShadow: number }
    | undefined;
  if (!row || row.isShadow === 1 || !row.handle) return null;
  return { userId: row.userId, name: row.name, handle: row.handle };
}

function loadGroupMemberByUser(
  groupId: number,
  userId: number,
): (MemberRecord & { groupId: number }) | null {
  const row = db
    .prepare(
      `SELECT gm.id AS memberId, gm.group_id AS groupId, gm.user_id AS userId,
              u.name, u.handle, gm.role, u.is_shadow AS isShadow,
              u.claimed_at AS claimedAt, gm.snoozed_until AS snoozedUntil,
              gm.last_reminded_at AS lastRemindedAt
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ? AND gm.user_id = ?`,
    )
    .get(groupId, userId) as
    | (Omit<MemberRecord, 'isShadow'> & { isShadow: number; groupId: number })
    | undefined;
  if (!row) return null;
  return { ...row, isShadow: row.isShadow === 1 };
}

function loadGroupMemberById(
  memberId: number,
): (MemberRecord & { groupId: number }) | null {
  const row = db
    .prepare(
      `SELECT gm.id AS memberId, gm.group_id AS groupId, gm.user_id AS userId,
              u.name, u.handle, gm.role, u.is_shadow AS isShadow,
              u.claimed_at AS claimedAt, gm.snoozed_until AS snoozedUntil,
              gm.last_reminded_at AS lastRemindedAt
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.id = ?`,
    )
    .get(memberId) as
    | (Omit<MemberRecord, 'isShadow'> & { isShadow: number; groupId: number })
    | undefined;
  if (!row) return null;
  return { ...row, isShadow: row.isShadow === 1 };
}

const VALID_GROUP_ICONS = new Set([
  'home',
  'compass',
  'utensils',
  'users',
  'bolt',
  'wallet',
]);
const VALID_ACCENT_THEMES = new Set([
  'emerald',
  'violet',
  'teal',
  'indigo',
  'rose',
]);

function normalizeGroupIcon(raw?: unknown): string {
  const val = String(raw ?? 'home').trim().toLowerCase();
  return VALID_GROUP_ICONS.has(val) ? val : 'home';
}

function normalizeAccentTheme(raw?: unknown): string {
  const val = String(raw ?? 'emerald').trim().toLowerCase();
  return VALID_ACCENT_THEMES.has(val) ? val : 'emerald';
}

function loadUserGroups(userId: number) {
  const rows = db
    .prepare(
      `SELECT g.id, g.name, g.currency_code AS currencyCode,
              g.icon_key AS iconKey, g.accent_theme AS accentTheme,
              gm.role, gm.id AS memberId,
              (SELECT COUNT(*) FROM group_members gm2 WHERE gm2.group_id = g.id) AS memberCount,
              (SELECT COUNT(*) FROM settlements s WHERE s.group_id = g.id AND s.status = 'PENDING_CONFIRMATION') AS pendingCount
       FROM group_members gm
       JOIN groups g ON g.id = gm.group_id
       WHERE gm.user_id = ?
       ORDER BY datetime(g.created_at) DESC, g.id DESC`,
    )
    .all(userId) as Array<{
    id: number;
    name: string;
    currencyCode: string;
    iconKey: string;
    accentTheme: string;
    role: Role;
    memberId: number;
    memberCount: number;
    pendingCount: number;
  }>;
  return rows;
}

function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Please sign in to continue.' });
    return;
  }
  const token = header.slice(7).trim();
  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Your session expired. Please sign in again.' });
    return;
  }
  const user = loadUserById(payload.userId);
  if (!user) {
    res.status(401).json({ error: 'Account not found or inactive.' });
    return;
  }
  req.authUser = user;
  next();
}

function requireGroupMember(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: 'Please sign in to continue.' });
    return;
  }
  const groupId = Number(req.params.groupId);
  if (!Number.isInteger(groupId) || groupId <= 0) {
    res.status(400).json({ error: 'Invalid group selected.' });
    return;
  }
  const member = loadGroupMemberByUser(groupId, user.userId);
  if (!member || member.isShadow) {
    res.status(403).json({ error: 'You are not a member of this group.' });
    return;
  }
  req.authMember = member;
  next();
}

const ALLOWED_RECEIPT_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf']);
const ALLOWED_RECEIPT_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      cb(null, UPLOADS_DIR);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = ALLOWED_RECEIPT_EXTS.has(ext) ? ext : '.bin';
      cb(null, `receipt-${crypto.randomUUID()}${safeExt}`);
    },
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_RECEIPT_EXTS.has(ext) || !ALLOWED_RECEIPT_MIMES.has(file.mimetype)) {
      cb(new Error('Only JPG, PNG, WEBP, or PDF receipts up to 3 MB are allowed.'));
      return;
    }
    cb(null, true);
  },
});

function buildGroupState(groupId: number, currentUserId: number, currentMemberId: number) {
  const group = db
    .prepare(
      `SELECT id, name, currency_code AS currencyCode, icon_key AS iconKey,
              accent_theme AS accentTheme, quiet_hours_start AS quietHoursStart,
              quiet_hours_end AS quietHoursEnd, reminder_cooldown_hours AS reminderCooldownHours,
              created_at AS createdAt
       FROM groups WHERE id = ?`,
    )
    .get(groupId) as {
    id: number;
    name: string;
    currencyCode: string;
    iconKey: string;
    accentTheme: string;
    quietHoursStart: number;
    quietHoursEnd: number;
    reminderCooldownHours: number;
    createdAt: string;
  };

  const memberRows = db
    .prepare(
      `SELECT gm.id AS memberId, gm.user_id AS userId, u.name, u.handle, gm.role,
              u.is_shadow AS isShadow, u.claimed_at AS claimedAt,
              u.claim_token_expires_at AS claimTokenExpiresAt,
              gm.snoozed_until AS snoozedUntil, gm.last_reminded_at AS lastRemindedAt
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ?
       ORDER BY CASE gm.role WHEN 'HOST' THEN 0 WHEN 'ADMIN' THEN 1 ELSE 2 END, gm.id ASC`,
    )
    .all(groupId) as Array<
    Omit<MemberRecord, 'isShadow'> & {
      isShadow: number;
      claimTokenExpiresAt: string | null;
    }
  >;

  const members: Array<MemberRecord & { claimTokenExpiresAt: string | null }> =
    memberRows.map((m) => ({
      ...m,
      isShadow: m.isShadow === 1,
    }));

  const memberNameMap = new Map<number, string>(
    members.map((m) => [m.memberId, m.name]),
  );

  const expenses = db
    .prepare(
      `SELECT id, group_id AS groupId, paid_by_member_id AS paidByMemberId,
              title, category, total_minor AS totalMinor, split_mode AS splitMode,
              status, void_reason AS voidReason, voided_by_member_id AS voidedByMemberId,
              receipt_path AS receiptPath, created_at AS createdAt
       FROM expenses
       WHERE group_id = ?
       ORDER BY datetime(created_at) DESC, id DESC`,
    )
    .all(groupId) as ExpenseRecord[];

  const splits = db
    .prepare(
      `SELECT es.expense_id AS expenseId, es.member_id AS memberId, es.amount_minor AS amountMinor
       FROM expense_splits es
       JOIN expenses e ON e.id = es.expense_id
       WHERE e.group_id = ?`,
    )
    .all(groupId) as SplitRecord[];

  const settlements = db
    .prepare(
      `SELECT id, group_id AS groupId, from_member_id AS fromMemberId,
              to_member_id AS toMemberId, amount_minor AS amountMinor, status,
              note, receipt_path AS receiptPath, rejection_reason AS rejectionReason,
              acted_by_member_id AS actedByMemberId, created_at AS createdAt, updated_at AS updatedAt
       FROM settlements
       WHERE group_id = ?
       ORDER BY datetime(created_at) DESC, id DESC`,
    )
    .all(groupId) as SettlementRecord[];

  const auditRows = db
    .prepare(
      `SELECT id, group_id AS groupId, actor_member_id AS actorMemberId,
              action_type AS actionType, entity_type AS entityType, entity_id AS entityId,
              payload_json AS payloadJson, created_at AS createdAt
       FROM audit_logs
       WHERE group_id = ?
       ORDER BY datetime(created_at) DESC, id DESC
       LIMIT 150`,
    )
    .all(groupId) as Array<{
    id: number;
    groupId: number;
    actorMemberId: number | null;
    actionType: string;
    entityType: string;
    entityId: number | null;
    payloadJson: string;
    createdAt: string;
  }>;

  const balances = computeGroupBalances(members, expenses, splits, settlements);

  const splitsByExpense = new Map<
    number,
    Array<{ memberId: number; memberName: string; amountMinor: number }>
  >();
  for (const sp of splits) {
    const list = splitsByExpense.get(sp.expenseId) ?? [];
    list.push({
      memberId: sp.memberId,
      memberName: memberNameMap.get(sp.memberId) ?? `Member ${sp.memberId}`,
      amountMinor: sp.amountMinor,
    });
    splitsByExpense.set(sp.expenseId, list);
  }

  const enrichedExpenses = expenses.map((e) => ({
    ...e,
    paidByName: memberNameMap.get(e.paidByMemberId) ?? `Member ${e.paidByMemberId}`,
    voidedByName: e.voidedByMemberId
      ? (memberNameMap.get(e.voidedByMemberId) ?? null)
      : null,
    splits: splitsByExpense.get(e.id) ?? [],
  }));

  const enrichedSettlements = settlements.map((s) => ({
    ...s,
    fromName: memberNameMap.get(s.fromMemberId) ?? `Member ${s.fromMemberId}`,
    toName: memberNameMap.get(s.toMemberId) ?? `Member ${s.toMemberId}`,
    actedByName: s.actedByMemberId
      ? (memberNameMap.get(s.actedByMemberId) ?? null)
      : null,
  }));

  const auditLogs = auditRows.map((row) => {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    return {
      id: row.id,
      groupId: row.groupId,
      actorMemberId: row.actorMemberId,
      actorName: row.actorMemberId
        ? (memberNameMap.get(row.actorMemberId) ?? `Member ${row.actorMemberId}`)
        : 'System',
      actionType: row.actionType,
      entityType: row.entityType,
      entityId: row.entityId,
      payload,
      createdAt: row.createdAt,
    };
  });

  const now = new Date();
  const reminderStatuses = members.map((m) => {
    const net = balances.netBalances.find((n) => n.memberId === m.memberId);
    const owedMinor = net && net.netMinor < 0 ? Math.abs(net.netMinor) : 0;
    const evaluation = evaluateReminderEligibility(
      group.quietHoursStart,
      group.quietHoursEnd,
      group.reminderCooldownHours,
      m.snoozedUntil,
      m.lastRemindedAt,
      now,
    );
    return {
      memberId: m.memberId,
      name: m.name,
      isShadow: m.isShadow,
      owedMinor,
      ...evaluation,
    };
  });

  return {
    currentMemberId,
    groups: loadUserGroups(currentUserId),
    group,
    members,
    expenses: enrichedExpenses,
    settlements: enrichedSettlements,
    balances,
    reminderStatuses,
    auditLogs,
  };
}

const AUTH_RATE_WINDOW_MS = 10 * 60 * 1000;
const AUTH_RATE_MAX_ATTEMPTS = 25;
const authAttempts = new Map<string, number[]>();

function checkAuthRateLimit(req: Request, res: Response, scope: string): boolean {
  const now = Date.now();
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const key = `${scope}:${ip}`;
  const recent = (authAttempts.get(key) ?? []).filter(
    (ts) => now - ts < AUTH_RATE_WINDOW_MS,
  );
  if (recent.length >= AUTH_RATE_MAX_ATTEMPTS) {
    authAttempts.set(key, recent);
    res
      .status(429)
      .json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    return false;
  }
  recent.push(now);
  authAttempts.set(key, recent);
  if (authAttempts.size > 1000) {
    for (const [k, list] of authAttempts.entries()) {
      const valid = list.filter((ts) => now - ts < AUTH_RATE_WINDOW_MS);
      if (valid.length === 0) authAttempts.delete(k);
      else authAttempts.set(k, valid);
    }
  }
  return true;
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/auth/register', (req, res) => {
    if (!checkAuthRateLimit(req, res, 'register')) return;
    const { name, handle, password, initialGroupName, iconKey, accentTheme } =
      req.body as {
        name?: string;
        handle?: string;
        password?: string;
        initialGroupName?: string;
        iconKey?: string;
        accentTheme?: string;
      };

    const cleanName = String(name ?? '').trim();
    const cleanHandle = String(handle ?? '')
      .trim()
      .replace(/^@/, '')
      .toLowerCase();
    const rawPassword = String(password ?? '');
    const cleanGroupName = String(initialGroupName ?? '').trim();
    const cleanIcon = normalizeGroupIcon(iconKey);
    const cleanTheme = normalizeAccentTheme(accentTheme);

    if (cleanName.length < 2 || cleanName.length > 60) {
      res.status(400).json({ error: 'Name must be between 2 and 60 characters.' });
      return;
    }
    if (!/^[a-z0-9_]{3,24}$/.test(cleanHandle)) {
      res.status(400).json({
        error: 'Username must be 3–24 lowercase letters, numbers, or underscores.',
      });
      return;
    }
    if (rawPassword.length < 6 || rawPassword.length > 128) {
      res
        .status(400)
        .json({ error: 'Password must be between 6 and 128 characters.' });
      return;
    }

    const existing = db
      .prepare(`SELECT id FROM users WHERE LOWER(handle) = ?`)
      .get(cleanHandle) as { id: number } | undefined;
    if (existing) {
      res.status(409).json({ error: `Username @${cleanHandle} is already taken.` });
      return;
    }

    const now = new Date().toISOString();
    const created = db.transaction(() => {
      const userId = Number(
        db
          .prepare(
            `INSERT INTO users (name, handle, password_hash, is_shadow, claimed_at, created_at)
             VALUES (?, ?, ?, 0, ?, ?)`,
          )
          .run(cleanName, cleanHandle, hashPassword(rawPassword), now, now)
          .lastInsertRowid,
      );

      let initialGroupId: number | null = null;
      if (cleanGroupName.length >= 2) {
        initialGroupId = Number(
          db
            .prepare(
              `INSERT INTO groups (name, currency_code, icon_key, accent_theme, quiet_hours_start, quiet_hours_end, reminder_cooldown_hours, created_by_user_id, created_at)
               VALUES (?, 'PKR', ?, ?, 22, 8, 12, ?, ?)`,
            )
            .run(cleanGroupName.slice(0, 80), cleanIcon, cleanTheme, userId, now)
            .lastInsertRowid,
        );

        const memberId = Number(
          db
            .prepare(
              `INSERT INTO group_members (group_id, user_id, role, joined_at)
               VALUES (?, ?, 'HOST', ?)`,
            )
            .run(initialGroupId, userId, now).lastInsertRowid,
        );

        appendAuditLog(db, {
          groupId: initialGroupId,
          actorMemberId: memberId,
          actionType: 'GROUP_CREATED',
          entityType: 'GROUP',
          entityId: initialGroupId,
          payload: { name: cleanGroupName.slice(0, 80), currency: 'PKR' },
          createdAt: now,
        });
      }

      return { userId, initialGroupId };
    })();

    const token = signSessionToken(created.userId);
    const user = loadUserById(created.userId)!;
    const groups = loadUserGroups(created.userId);
    res.status(201).json({ token, user, groups, activeGroupId: created.initialGroupId });
  });

  app.post('/api/auth/login', (req, res) => {
    if (!checkAuthRateLimit(req, res, 'login')) return;
    const { handle, password } = req.body as {
      handle?: string;
      password?: string;
    };
    if (!handle || !password) {
      res.status(400).json({ error: 'Username and password are required.' });
      return;
    }
    const cleanHandle = handle.trim().replace(/^@/, '').toLowerCase();
    const row = db
      .prepare(
        `SELECT id AS userId, name, handle, password_hash AS passwordHash, is_shadow AS isShadow
         FROM users WHERE LOWER(handle) = ? LIMIT 1`,
      )
      .get(cleanHandle) as
      | {
          userId: number;
          name: string;
          handle: string;
          passwordHash: string | null;
          isShadow: number;
        }
      | undefined;

    if (!row || row.isShadow === 1 || !row.passwordHash) {
      res.status(401).json({ error: 'Incorrect username or password.' });
      return;
    }
    if (!verifyPassword(password, row.passwordHash)) {
      res.status(401).json({ error: 'Incorrect username or password.' });
      return;
    }

    const token = signSessionToken(row.userId);
    const groups = loadUserGroups(row.userId);
    res.json({
      token,
      user: { userId: row.userId, name: row.name, handle: row.handle },
      groups,
      activeGroupId: groups[0]?.id ?? null,
    });
  });

  app.get('/api/me', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    res.json({
      user,
      groups: loadUserGroups(user.userId),
    });
  });

  app.get('/api/groups', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    res.json({ groups: loadUserGroups(user.userId) });
  });

  app.post('/api/groups', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const {
      name,
      iconKey,
      accentTheme,
      quietHoursStart,
      quietHoursEnd,
      reminderCooldownHours,
    } = req.body as {
      name?: string;
      iconKey?: string;
      accentTheme?: string;
      quietHoursStart?: number;
      quietHoursEnd?: number;
      reminderCooldownHours?: number;
    };

    const cleanName = String(name ?? '').trim();
    if (cleanName.length < 2 || cleanName.length > 80) {
      res.status(400).json({ error: 'Group name must be 2–80 characters.' });
      return;
    }

    const cleanIcon = normalizeGroupIcon(iconKey);
    const cleanTheme = normalizeAccentTheme(accentTheme);
    const qStart =
      quietHoursStart === undefined ? 22 : Number(quietHoursStart);
    const qEnd = quietHoursEnd === undefined ? 8 : Number(quietHoursEnd);
    const cooldown =
      reminderCooldownHours === undefined ? 12 : Number(reminderCooldownHours);

    if (
      !Number.isInteger(qStart) ||
      qStart < 0 ||
      qStart > 23 ||
      !Number.isInteger(qEnd) ||
      qEnd < 0 ||
      qEnd > 23 ||
      !Number.isInteger(cooldown) ||
      cooldown < 1 ||
      cooldown > 168
    ) {
      res.status(400).json({ error: 'Invalid reminder quiet hours or cooldown.' });
      return;
    }

    const now = new Date().toISOString();
    const created = db.transaction(() => {
      const groupId = Number(
        db
          .prepare(
            `INSERT INTO groups (name, currency_code, icon_key, accent_theme, quiet_hours_start, quiet_hours_end, reminder_cooldown_hours, created_by_user_id, created_at)
             VALUES (?, 'PKR', ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(cleanName, cleanIcon, cleanTheme, qStart, qEnd, cooldown, user.userId, now)
          .lastInsertRowid,
      );

      const memberId = Number(
        db
          .prepare(
            `INSERT INTO group_members (group_id, user_id, role, joined_at)
             VALUES (?, ?, 'HOST', ?)`,
          )
          .run(groupId, user.userId, now).lastInsertRowid,
      );

      appendAuditLog(db, {
        groupId,
        actorMemberId: memberId,
        actionType: 'GROUP_CREATED',
        entityType: 'GROUP',
        entityId: groupId,
        payload: { name: cleanName, iconKey: cleanIcon, accentTheme: cleanTheme },
        createdAt: now,
      });

      return { groupId, memberId };
    })();

    res.status(201).json({
      groupId: created.groupId,
      state: buildGroupState(created.groupId, user.userId, created.memberId),
    });
  });

  app.patch(
    '/api/groups/:groupId/appearance',
    requireAuth,
    requireGroupMember,
    (req: AuthenticatedRequest, res) => {
      const actor = req.authMember!;
      const user = req.authUser!;
      if (actor.role !== 'HOST' && actor.role !== 'ADMIN') {
        res
          .status(403)
          .json({ error: 'Only a group Host or Admin can customize the group badge.' });
        return;
      }

      const { iconKey, accentTheme } = req.body as {
        iconKey?: string;
        accentTheme?: string;
      };
      const cleanIcon = normalizeGroupIcon(iconKey);
      const cleanTheme = normalizeAccentTheme(accentTheme);
      const now = new Date().toISOString();

      db.transaction(() => {
        db.prepare(
          `UPDATE groups SET icon_key = ?, accent_theme = ? WHERE id = ?`,
        ).run(cleanIcon, cleanTheme, actor.groupId);

        appendAuditLog(db, {
          groupId: actor.groupId,
          actorMemberId: actor.memberId,
          actionType: 'GROUP_STYLE_UPDATED',
          entityType: 'GROUP',
          entityId: actor.groupId,
          payload: { iconKey: cleanIcon, accentTheme: cleanTheme },
          createdAt: now,
        });
      })();

      res.json({
        state: buildGroupState(actor.groupId, user.userId, actor.memberId),
      });
    },
  );

  app.get(
    '/api/groups/:groupId/state',
    requireAuth,
    requireGroupMember,
    (req: AuthenticatedRequest, res) => {
      const member = req.authMember!;
      const user = req.authUser!;
      res.json(buildGroupState(member.groupId, user.userId, member.memberId));
    },
  );

  app.post(
    '/api/groups/:groupId/members',
    requireAuth,
    requireGroupMember,
    (req: AuthenticatedRequest, res) => {
      const actor = req.authMember!;
      const user = req.authUser!;
      if (actor.role !== 'HOST' && actor.role !== 'ADMIN') {
        res.status(403).json({ error: 'Only a group Host or Admin can add members.' });
        return;
      }

      const rawHandle = String((req.body as { handle?: string }).handle ?? '')
        .trim()
        .replace(/^@/, '')
        .toLowerCase();
      if (!/^[a-z0-9_]{3,24}$/.test(rawHandle)) {
        res.status(400).json({ error: 'Enter a valid @username (3–24 characters) to add.' });
        return;
      }

      const targetUser = db
        .prepare(
          `SELECT id, name, handle, is_shadow AS isShadow FROM users WHERE LOWER(handle) = ?`,
        )
        .get(rawHandle) as
        | { id: number; name: string; handle: string; isShadow: number }
        | undefined;

      if (!targetUser || targetUser.isShadow === 1) {
        res.status(404).json({
          error: `No registered account found for @${rawHandle}. Use "Add Unregistered Friend" if they haven't signed up yet.`,
        });
        return;
      }

      const existing = db
        .prepare(
          `SELECT id FROM group_members WHERE group_id = ? AND user_id = ?`,
        )
        .get(actor.groupId, targetUser.id) as { id: number } | undefined;
      if (existing) {
        res.status(409).json({ error: `${targetUser.name} is already in this group.` });
        return;
      }

      const now = new Date().toISOString();
      db.transaction(() => {
        const newMemberId = Number(
          db
            .prepare(
              `INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'MEMBER', ?)`,
            )
            .run(actor.groupId, targetUser.id, now).lastInsertRowid,
        );

        appendAuditLog(db, {
          groupId: actor.groupId,
          actorMemberId: actor.memberId,
          actionType: 'MEMBER_ADDED',
          entityType: 'MEMBER',
          entityId: newMemberId,
          payload: { name: targetUser.name, handle: targetUser.handle },
          createdAt: now,
        });
      })();

      res.status(201).json({
        state: buildGroupState(actor.groupId, user.userId, actor.memberId),
      });
    },
  );

  app.get('/api/receipts/:filename', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const rawName = path.basename(req.params.filename || '');
    if (!/^receipt-[0-9a-f-]{36}\.(jpg|jpeg|png|webp|pdf)$/i.test(rawName)) {
      res.status(400).json({ error: 'Invalid receipt identifier.' });
      return;
    }

    const receiptRoutePath = `/api/receipts/${rawName}`;
    const ownsExpenseReceipt = db
      .prepare(
        `SELECT 1 FROM expenses e
         JOIN group_members gm ON gm.group_id = e.group_id
         WHERE e.receipt_path = ? AND gm.user_id = ?
         LIMIT 1`,
      )
      .get(receiptRoutePath, user.userId);
    const ownsSettlementReceipt = db
      .prepare(
        `SELECT 1 FROM settlements s
         JOIN group_members gm ON gm.group_id = s.group_id
         WHERE s.receipt_path = ? AND gm.user_id = ?
         LIMIT 1`,
      )
      .get(receiptRoutePath, user.userId);

    if (!ownsExpenseReceipt && !ownsSettlementReceipt) {
      res.status(403).json({ error: 'You do not have permission to view this receipt.' });
      return;
    }

    const resolved = path.resolve(UPLOADS_DIR, rawName);
    if (!resolved.startsWith(UPLOADS_DIR + path.sep)) {
      res.status(400).json({ error: 'Invalid receipt path.' });
      return;
    }
    if (!fs.existsSync(resolved)) {
      res.status(404).json({ error: 'Receipt not found.' });
      return;
    }
    res.setHeader('Content-Disposition', `inline; filename="${rawName}"`);
    res.sendFile(resolved);
  });

  app.post(
    '/api/groups/:groupId/expenses',
    requireAuth,
    requireGroupMember,
    upload.single('receipt'),
    (req: AuthenticatedRequest, res) => {
      try {
        const actor = req.authMember!;
        const user = req.authUser!;
        const body = req.body as Record<string, unknown>;
        const title = String(body.title ?? '').trim();
        const category = String(body.category ?? 'General').trim() || 'General';
        const splitMode = String(body.splitMode ?? 'EQUAL') as 'EQUAL' | 'CUSTOM';
        const paidByMemberId = Number(body.paidByMemberId ?? actor.memberId);

        if (!title || title.length > 120) {
          res.status(400).json({ error: 'Title is required (max 120 characters).' });
          return;
        }
        if (category.length > 40) {
          res.status(400).json({ error: 'Category must be 40 characters or less.' });
          return;
        }
        if (!Number.isInteger(paidByMemberId) || paidByMemberId <= 0) {
          res.status(400).json({ error: 'Invalid payer selected.' });
          return;
        }
        if (splitMode !== 'EQUAL' && splitMode !== 'CUSTOM') {
          res.status(400).json({ error: 'Choose Equal or Custom split.' });
          return;
        }

        const totalMinor = parsePkrToMinor(
          typeof body.amountPkr === 'string' || typeof body.amountPkr === 'number'
            ? body.amountPkr
            : String(body.totalMinor ? Number(body.totalMinor) / 100 : ''),
        );

        const groupMembers = db
          .prepare(`SELECT id FROM group_members WHERE group_id = ?`)
          .all(actor.groupId) as Array<{ id: number }>;
        const validMemberSet = new Set(groupMembers.map((m) => m.id));

        if (!validMemberSet.has(paidByMemberId)) {
          res.status(400).json({ error: 'Payer must belong to this group.' });
          return;
        }

        let resolvedSplits: Array<{ memberId: number; amountMinor: number }>;
        if (splitMode === 'EQUAL') {
          let rawIds: unknown;
          try {
            rawIds =
              typeof body.participantMemberIds === 'string'
                ? JSON.parse(body.participantMemberIds)
                : body.participantMemberIds;
          } catch {
            res.status(400).json({ error: 'Invalid participant list.' });
            return;
          }
          if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > 100) {
            res
              .status(400)
              .json({ error: 'Select between 1 and 100 people to split this bill.' });
            return;
          }
          for (const id of rawIds) {
            if (!validMemberSet.has(Number(id))) {
              res.status(400).json({ error: 'Invalid person selected.' });
              return;
            }
          }
          resolvedSplits = computeEqualSplits(
            totalMinor,
            rawIds.map((id) => Number(id)),
          );
        } else {
          let rawCustom: unknown;
          try {
            rawCustom =
              typeof body.customSplits === 'string'
                ? JSON.parse(body.customSplits)
                : body.customSplits;
          } catch {
            res.status(400).json({ error: 'Invalid custom split data.' });
            return;
          }
          if (!Array.isArray(rawCustom) || rawCustom.length === 0 || rawCustom.length > 100) {
            res.status(400).json({ error: 'Custom split amounts are required.' });
            return;
          }
          for (const item of rawCustom as Array<{ memberId?: unknown }>) {
            if (!validMemberSet.has(Number(item?.memberId))) {
              res.status(400).json({ error: 'Invalid person in custom split.' });
              return;
            }
          }
          resolvedSplits = validateCustomSplits(
            totalMinor,
            (rawCustom as Array<{ memberId: unknown; amountMinor: unknown }>).map((item) => ({
              memberId: Number(item.memberId),
              amountMinor: Number(item.amountMinor),
            })),
          );
        }

        const receiptPath = req.file ? `/api/receipts/${req.file.filename}` : null;
        const now = new Date().toISOString();

        const expenseId = db.transaction(() => {
          const expId = Number(
            db
              .prepare(
                `INSERT INTO expenses (group_id, paid_by_member_id, title, category, total_minor, split_mode, status, receipt_path, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
              )
              .run(
                actor.groupId,
                paidByMemberId,
                title,
                category,
                totalMinor,
                splitMode,
                receiptPath,
                now,
              ).lastInsertRowid,
          );

          const insertSplit = db.prepare(
            `INSERT INTO expense_splits (expense_id, member_id, amount_minor) VALUES (?, ?, ?)`,
          );
          for (const sp of resolvedSplits) {
            insertSplit.run(expId, sp.memberId, sp.amountMinor);
          }

          appendAuditLog(db, {
            groupId: actor.groupId,
            actorMemberId: actor.memberId,
            actionType: 'EXPENSE_CREATED',
            entityType: 'EXPENSE',
            entityId: expId,
            payload: {
              title,
              category,
              amount: formatMinorToPkr(totalMinor),
              splitMode,
              paidByMemberId,
              splitCount: resolvedSplits.length,
              hasReceipt: Boolean(receiptPath),
            },
            createdAt: now,
          });

          return expId;
        })();

        res.status(201).json({
          expenseId,
          state: buildGroupState(actor.groupId, user.userId, actor.memberId),
        });
      } catch (err) {
        if (req.file) {
          fs.rmSync(req.file.path, { force: true });
        }
        const message = err instanceof Error ? err.message : 'Failed to save bill.';
        res.status(400).json({ error: message });
      }
    },
  );

  app.post(
    '/api/groups/:groupId/expenses/:expenseId/void',
    requireAuth,
    requireGroupMember,
    (req: AuthenticatedRequest, res) => {
      const actor = req.authMember!;
      const user = req.authUser!;
      const expenseId = Number(req.params.expenseId);
      const reason = String((req.body as { reason?: string }).reason ?? '').trim();

      if (!Number.isInteger(expenseId) || expenseId <= 0) {
        res.status(400).json({ error: 'Invalid bill selected.' });
        return;
      }
      if (!reason || reason.length < 3 || reason.length > 240) {
        res
          .status(400)
          .json({ error: 'Reason must be between 3 and 240 characters.' });
        return;
      }

      const expense = db
        .prepare(
          `SELECT id, group_id AS groupId, paid_by_member_id AS paidByMemberId, title, total_minor AS totalMinor, status
           FROM expenses WHERE id = ? AND group_id = ?`,
        )
        .get(expenseId, actor.groupId) as
        | {
            id: number;
            groupId: number;
            paidByMemberId: number;
            title: string;
            totalMinor: number;
            status: string;
          }
        | undefined;

      if (!expense) {
        res.status(404).json({ error: 'Bill not found.' });
        return;
      }
      if (expense.status === 'VOIDED') {
        res.status(409).json({ error: 'This bill has already been removed.' });
        return;
      }

      const canVoid =
        actor.role === 'HOST' ||
        actor.role === 'ADMIN' ||
        actor.memberId === expense.paidByMemberId;

      if (!canVoid) {
        res.status(403).json({
          error:
            'Only the person who paid, a group Admin, or the Host can remove this bill.',
        });
        return;
      }

      const now = new Date().toISOString();
      db.transaction(() => {
        db.prepare(
          `UPDATE expenses SET status = 'VOIDED', void_reason = ?, voided_by_member_id = ? WHERE id = ?`,
        ).run(reason, actor.memberId, expense.id);

        appendAuditLog(db, {
          groupId: actor.groupId,
          actorMemberId: actor.memberId,
          actionType: 'EXPENSE_VOIDED',
          entityType: 'EXPENSE',
          entityId: expense.id,
          payload: {
            title: expense.title,
            amount: formatMinorToPkr(expense.totalMinor),
            reason,
          },
          createdAt: now,
        });
      })();

      res.json({
        state: buildGroupState(actor.groupId, user.userId, actor.memberId),
      });
    },
  );

  app.post(
    '/api/groups/:groupId/settlements',
    requireAuth,
    requireGroupMember,
    upload.single('receipt'),
    (req: AuthenticatedRequest, res) => {
      try {
        const actor = req.authMember!;
        const user = req.authUser!;
        const body = req.body as Record<string, unknown>;
        const fromMemberId = Number(body.fromMemberId ?? actor.memberId);
        const toMemberId = Number(body.toMemberId);
        const rawNote = String(body.note ?? '').trim();
        if (rawNote.length > 200) {
          res.status(400).json({ error: 'Payment note must be 200 characters or less.' });
          return;
        }
        const note = rawNote || null;

        if (!Number.isInteger(fromMemberId) || !Number.isInteger(toMemberId)) {
          res.status(400).json({ error: 'Choose who paid and who received.' });
          return;
        }
        if (fromMemberId === toMemberId) {
          res
            .status(400)
            .json({ error: 'Sender and recipient cannot be the same person.' });
          return;
        }

        const fromMember = loadGroupMemberById(fromMemberId);
        const toMember = loadGroupMemberById(toMemberId);
        if (
          !fromMember ||
          !toMember ||
          fromMember.groupId !== actor.groupId ||
          toMember.groupId !== actor.groupId
        ) {
          res.status(400).json({ error: 'Both people must belong to this group.' });
          return;
        }

        const canInitiate =
          actor.memberId === fromMemberId ||
          actor.role === 'HOST' ||
          actor.role === 'ADMIN';
        if (!canInitiate) {
          res
            .status(403)
            .json({ error: 'You can only record payments sent from your own account.' });
          return;
        }

        const amountMinor = parsePkrToMinor(String(body.amountPkr ?? ''));
        const receiptPath = req.file ? `/api/receipts/${req.file.filename}` : null;
        const now = new Date().toISOString();

        const settlementId = db.transaction(() => {
          const stId = Number(
            db
              .prepare(
                `INSERT INTO settlements (group_id, from_member_id, to_member_id, amount_minor, status, note, receipt_path, created_at, updated_at)
                 VALUES (?, ?, ?, ?, 'PENDING_CONFIRMATION', ?, ?, ?, ?)`,
              )
              .run(
                actor.groupId,
                fromMemberId,
                toMemberId,
                amountMinor,
                note,
                receiptPath,
                now,
                now,
              ).lastInsertRowid,
          );

          appendAuditLog(db, {
            groupId: actor.groupId,
            actorMemberId: actor.memberId,
            actionType: 'SETTLEMENT_CREATED',
            entityType: 'SETTLEMENT',
            entityId: stId,
            payload: {
              fromMemberId,
              toMemberId,
              amount: formatMinorToPkr(amountMinor),
              note,
              hasReceipt: Boolean(receiptPath),
            },
            createdAt: now,
          });

          return stId;
        })();

        res.status(201).json({
          settlementId,
          state: buildGroupState(actor.groupId, user.userId, actor.memberId),
        });
      } catch (err) {
        if (req.file) {
          fs.rmSync(req.file.path, { force: true });
        }
        const message =
          err instanceof Error ? err.message : 'Failed to record payment.';
        res.status(400).json({ error: message });
      }
    },
  );

  app.post(
    '/api/groups/:groupId/settlements/:settlementId/confirm',
    requireAuth,
    requireGroupMember,
    (req: AuthenticatedRequest, res) => {
      const actor = req.authMember!;
      const user = req.authUser!;
      const settlementId = Number(req.params.settlementId);
      if (!Number.isInteger(settlementId) || settlementId <= 0) {
        res.status(400).json({ error: 'Invalid payment selected.' });
        return;
      }
      const st = db
        .prepare(
          `SELECT id, group_id AS groupId, from_member_id AS fromMemberId,
                  to_member_id AS toMemberId, amount_minor AS amountMinor, status
           FROM settlements WHERE id = ? AND group_id = ?`,
        )
        .get(settlementId, actor.groupId) as
        | {
            id: number;
            groupId: number;
            fromMemberId: number;
            toMemberId: number;
            amountMinor: number;
            status: string;
          }
        | undefined;

      if (!st) {
        res.status(404).json({ error: 'Payment not found.' });
        return;
      }
      if (st.status !== 'PENDING_CONFIRMATION') {
        res.status(409).json({ error: 'This payment is no longer pending.' });
        return;
      }

      if (actor.memberId === st.fromMemberId && actor.role === 'MEMBER') {
        res.status(403).json({ error: 'You cannot confirm your own outgoing payment.' });
        return;
      }

      const canConfirm =
        actor.memberId === st.toMemberId ||
        actor.role === 'HOST' ||
        actor.role === 'ADMIN';
      if (!canConfirm) {
        res.status(403).json({
          error: 'Only the recipient, Admin, or Host can confirm this payment.',
        });
        return;
      }

      const now = new Date().toISOString();
      db.transaction(() => {
        db.prepare(
          `UPDATE settlements SET status = 'CONFIRMED', acted_by_member_id = ?, updated_at = ? WHERE id = ?`,
        ).run(actor.memberId, now, st.id);

        appendAuditLog(db, {
          groupId: actor.groupId,
          actorMemberId: actor.memberId,
          actionType: 'SETTLEMENT_CONFIRMED',
          entityType: 'SETTLEMENT',
          entityId: st.id,
          payload: {
            fromMemberId: st.fromMemberId,
            toMemberId: st.toMemberId,
            amount: formatMinorToPkr(st.amountMinor),
          },
          createdAt: now,
        });
      })();

      res.json({
        state: buildGroupState(actor.groupId, user.userId, actor.memberId),
      });
    },
  );

  app.post(
    '/api/groups/:groupId/settlements/:settlementId/reject',
    requireAuth,
    requireGroupMember,
    (req: AuthenticatedRequest, res) => {
      const actor = req.authMember!;
      const user = req.authUser!;
      const settlementId = Number(req.params.settlementId);
      const reason = String((req.body as { reason?: string }).reason ?? '').trim();

      if (!Number.isInteger(settlementId) || settlementId <= 0) {
        res.status(400).json({ error: 'Invalid payment selected.' });
        return;
      }
      if (!reason || reason.length < 3 || reason.length > 240) {
        res
          .status(400)
          .json({ error: 'Decline reason must be between 3 and 240 characters.' });
        return;
      }

      const st = db
        .prepare(
          `SELECT id, group_id AS groupId, from_member_id AS fromMemberId,
                  to_member_id AS toMemberId, amount_minor AS amountMinor, status
           FROM settlements WHERE id = ? AND group_id = ?`,
        )
        .get(settlementId, actor.groupId) as
        | {
            id: number;
            groupId: number;
            fromMemberId: number;
            toMemberId: number;
            amountMinor: number;
            status: string;
          }
        | undefined;

      if (!st) {
        res.status(404).json({ error: 'Payment not found.' });
        return;
      }
      if (st.status !== 'PENDING_CONFIRMATION') {
        res.status(409).json({ error: 'This payment is no longer pending.' });
        return;
      }

      const canReject =
        actor.memberId === st.toMemberId ||
        actor.role === 'HOST' ||
        actor.role === 'ADMIN';
      if (!canReject) {
        res.status(403).json({
          error: 'Only the recipient, Admin, or Host can decline this payment.',
        });
        return;
      }

      const now = new Date().toISOString();
      db.transaction(() => {
        db.prepare(
          `UPDATE settlements SET status = 'REJECTED', rejection_reason = ?, acted_by_member_id = ?, updated_at = ? WHERE id = ?`,
        ).run(reason, actor.memberId, now, st.id);

        appendAuditLog(db, {
          groupId: actor.groupId,
          actorMemberId: actor.memberId,
          actionType: 'SETTLEMENT_REJECTED',
          entityType: 'SETTLEMENT',
          entityId: st.id,
          payload: {
            fromMemberId: st.fromMemberId,
            toMemberId: st.toMemberId,
            amount: formatMinorToPkr(st.amountMinor),
            reason,
          },
          createdAt: now,
        });
      })();

      res.json({
        state: buildGroupState(actor.groupId, user.userId, actor.memberId),
      });
    },
  );

  app.post(
    '/api/groups/:groupId/settlements/:settlementId/cancel',
    requireAuth,
    requireGroupMember,
    (req: AuthenticatedRequest, res) => {
      const actor = req.authMember!;
      const user = req.authUser!;
      const settlementId = Number(req.params.settlementId);
      if (!Number.isInteger(settlementId) || settlementId <= 0) {
        res.status(400).json({ error: 'Invalid payment selected.' });
        return;
      }
      const st = db
        .prepare(
          `SELECT id, group_id AS groupId, from_member_id AS fromMemberId,
                  to_member_id AS toMemberId, amount_minor AS amountMinor, status
           FROM settlements WHERE id = ? AND group_id = ?`,
        )
        .get(settlementId, actor.groupId) as
        | {
            id: number;
            groupId: number;
            fromMemberId: number;
            toMemberId: number;
            amountMinor: number;
            status: string;
          }
        | undefined;

      if (!st) {
        res.status(404).json({ error: 'Payment not found.' });
        return;
      }
      if (st.status !== 'PENDING_CONFIRMATION') {
        res.status(409).json({ error: 'This payment is no longer pending.' });
        return;
      }

      const canCancel =
        actor.memberId === st.fromMemberId ||
        actor.role === 'HOST' ||
        actor.role === 'ADMIN';
      if (!canCancel) {
        res.status(403).json({
          error: 'Only the sender, Admin, or Host can cancel this payment.',
        });
        return;
      }

      const now = new Date().toISOString();
      db.transaction(() => {
        db.prepare(
          `UPDATE settlements SET status = 'CANCELLED', acted_by_member_id = ?, updated_at = ? WHERE id = ?`,
        ).run(actor.memberId, now, st.id);

        appendAuditLog(db, {
          groupId: actor.groupId,
          actorMemberId: actor.memberId,
          actionType: 'SETTLEMENT_CANCELLED',
          entityType: 'SETTLEMENT',
          entityId: st.id,
          payload: {
            fromMemberId: st.fromMemberId,
            toMemberId: st.toMemberId,
            amount: formatMinorToPkr(st.amountMinor),
          },
          createdAt: now,
        });
      })();

      res.json({
        state: buildGroupState(actor.groupId, user.userId, actor.memberId),
      });
    },
  );

  app.post(
    '/api/groups/:groupId/shadow/invite',
    requireAuth,
    requireGroupMember,
    (req: AuthenticatedRequest, res) => {
      const actor = req.authMember!;
      const user = req.authUser!;
      if (actor.role !== 'HOST' && actor.role !== 'ADMIN') {
        res.status(403).json({
          error: 'Only a group Host or Admin can add an unregistered friend.',
        });
        return;
      }

      const name = String((req.body as { name?: string }).name ?? '').trim();
      if (!name || name.length < 2 || name.length > 60) {
        res.status(400).json({ error: 'Name must be 2–60 characters.' });
        return;
      }

      try {
        const tokenRecord = verificationProvider.issueToken({
          purpose: 'SHADOW_CLAIM',
          recipientLabel: name,
          detail: `Single-use invite code created by ${actor.name}`,
          ttlMinutes: 60 * 72,
        });

        const now = new Date().toISOString();
        const result = db.transaction(() => {
          const userId = Number(
            db
              .prepare(
                `INSERT INTO users (name, handle, password_hash, is_shadow, claim_token_hash, claim_token_expires_at, claimed_at, created_at)
                 VALUES (?, NULL, NULL, 1, ?, ?, NULL, ?)`,
              )
              .run(
                name,
                hashClaimToken(tokenRecord.token),
                tokenRecord.expiresAt,
                now,
              ).lastInsertRowid,
          );

          const memberId = Number(
            db
              .prepare(
                `INSERT INTO group_members (group_id, user_id, role, joined_at)
                 VALUES (?, ?, 'MEMBER', ?)`,
              )
              .run(actor.groupId, userId, now).lastInsertRowid,
          );

          appendAuditLog(db, {
            groupId: actor.groupId,
            actorMemberId: actor.memberId,
            actionType: 'FRIEND_INVITED',
            entityType: 'USER',
            entityId: userId,
            payload: {
              name,
              memberId,
              expiresAt: tokenRecord.expiresAt,
            },
            createdAt: now,
          });

          return { userId, memberId };
        })();

        res.status(201).json({
          memberId: result.memberId,
          inviteCode: tokenRecord.token,
          expiresAt: tokenRecord.expiresAt,
          state: buildGroupState(actor.groupId, user.userId, actor.memberId),
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to create invite.';
        res.status(400).json({ error: message });
      }
    },
  );

  app.post(
    '/api/groups/:groupId/shadow/:memberId/reissue',
    requireAuth,
    requireGroupMember,
    (req: AuthenticatedRequest, res) => {
      const actor = req.authMember!;
      const user = req.authUser!;
      if (actor.role !== 'HOST' && actor.role !== 'ADMIN') {
        res
          .status(403)
          .json({ error: 'Only a group Host or Admin can reissue an invite code.' });
        return;
      }

      const targetMemberId = Number(req.params.memberId);
      if (!Number.isInteger(targetMemberId) || targetMemberId <= 0) {
        res.status(400).json({ error: 'Invalid roommate selected.' });
        return;
      }
      const target = loadGroupMemberById(targetMemberId);
      if (!target || target.groupId !== actor.groupId || !target.isShadow) {
        res.status(404).json({ error: 'Unclaimed roommate profile not found.' });
        return;
      }

      const tokenRecord = verificationProvider.issueToken({
        purpose: 'SHADOW_CLAIM',
        recipientLabel: target.name,
        detail: `Reissued invite code by ${actor.name}`,
        ttlMinutes: 60 * 72,
      });

      const now = new Date().toISOString();
      db.transaction(() => {
        db.prepare(
          `UPDATE users SET claim_token_hash = ?, claim_token_expires_at = ? WHERE id = ? AND is_shadow = 1`,
        ).run(hashClaimToken(tokenRecord.token), tokenRecord.expiresAt, target.userId);

        appendAuditLog(db, {
          groupId: actor.groupId,
          actorMemberId: actor.memberId,
          actionType: 'INVITE_CODE_REISSUED',
          entityType: 'USER',
          entityId: target.userId,
          payload: { name: target.name },
          createdAt: now,
        });
      })();

      res.json({
        memberId: target.memberId,
        inviteCode: tokenRecord.token,
        expiresAt: tokenRecord.expiresAt,
        state: buildGroupState(actor.groupId, user.userId, actor.memberId),
      });
    },
  );

  app.post('/api/shadow/claim', (req, res) => {
    if (!checkAuthRateLimit(req, res, 'claim')) return;
    const { inviteCode, claimToken, handle, password, displayName } = req.body as {
      inviteCode?: string;
      claimToken?: string;
      handle?: string;
      password?: string;
      displayName?: string;
    };

    const rawToken = String(inviteCode ?? claimToken ?? '').trim();
    const cleanHandle = String(handle ?? '')
      .trim()
      .replace(/^@/, '')
      .toLowerCase();
    const rawPassword = String(password ?? '');
    const cleanDisplayName =
      typeof displayName === 'string' ? displayName.trim() : '';

    if (!rawToken || rawToken.length > 64) {
      res.status(400).json({ error: 'Valid invite code is required.' });
      return;
    }
    if (
      cleanDisplayName &&
      (cleanDisplayName.length < 2 || cleanDisplayName.length > 60)
    ) {
      res.status(400).json({ error: 'Display name must be 2–60 characters.' });
      return;
    }
    if (!/^[a-z0-9_]{3,24}$/.test(cleanHandle)) {
      res.status(400).json({
        error: 'Username must be 3–24 lowercase letters, numbers, or underscores.',
      });
      return;
    }
    if (rawPassword.length < 6 || rawPassword.length > 128) {
      res
        .status(400)
        .json({ error: 'Password must be between 6 and 128 characters.' });
      return;
    }

    const tokenHash = hashClaimToken(rawToken);
    const now = new Date().toISOString();

    try {
      const claimed = db.transaction(() => {
        const userRow = db
          .prepare(
            `SELECT u.id AS userId, u.name, u.is_shadow AS isShadow,
                    u.claim_token_expires_at AS expiresAt, u.claimed_at AS claimedAt,
                    gm.id AS memberId, gm.group_id AS groupId
             FROM users u
             JOIN group_members gm ON gm.user_id = u.id
             WHERE u.claim_token_hash = ?`,
          )
          .get(tokenHash) as
          | {
              userId: number;
              name: string;
              isShadow: number;
              expiresAt: string | null;
              claimedAt: string | null;
              memberId: number;
              groupId: number;
            }
          | undefined;

        if (!userRow) {
          throw new Error(
            'Invite code is invalid, expired, or has already been used.',
          );
        }
        if (userRow.isShadow !== 1 || userRow.claimedAt !== null) {
          throw new Error('This profile has already been claimed.');
        }
        if (
          userRow.expiresAt &&
          new Date(userRow.expiresAt).getTime() <= Date.now()
        ) {
          throw new Error('This invite code has expired. Ask the group Host for a new one.');
        }

        const handleConflict = db
          .prepare(`SELECT id FROM users WHERE LOWER(handle) = ? AND id != ?`)
          .get(cleanHandle, userRow.userId) as { id: number } | undefined;
        if (handleConflict) {
          throw new Error(`Username @${cleanHandle} is already taken.`);
        }

        const updatedName = cleanDisplayName || userRow.name;

        const updateResult = db
          .prepare(
            `UPDATE users
             SET name = ?, handle = ?, password_hash = ?, is_shadow = 0,
                 claim_token_hash = NULL, claim_token_expires_at = NULL, claimed_at = ?
             WHERE id = ? AND is_shadow = 1 AND claimed_at IS NULL`,
          )
          .run(updatedName, cleanHandle, hashPassword(rawPassword), now, userRow.userId);

        if (updateResult.changes !== 1) {
          throw new Error('This profile has already been claimed.');
        }

        appendAuditLog(db, {
          groupId: userRow.groupId,
          actorMemberId: userRow.memberId,
          actionType: 'INVITE_CLAIMED',
          entityType: 'USER',
          entityId: userRow.userId,
          payload: {
            name: updatedName,
            handle: cleanHandle,
          },
          createdAt: now,
        });

        return {
          userId: userRow.userId,
          memberId: userRow.memberId,
          groupId: userRow.groupId,
          name: updatedName,
          handle: cleanHandle,
        };
      })();

      verificationProvider.consumeToken(rawToken);
      const token = signSessionToken(claimed.userId);

      res.json({
        token,
        user: {
          userId: claimed.userId,
          name: claimed.name,
          handle: claimed.handle,
        },
        activeGroupId: claimed.groupId,
        groups: loadUserGroups(claimed.userId),
        state: buildGroupState(claimed.groupId, claimed.userId, claimed.memberId),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to claim invite code.';
      res.status(409).json({ error: message });
    }
  });

  app.patch(
    '/api/groups/:groupId/reminders/settings',
    requireAuth,
    requireGroupMember,
    (req: AuthenticatedRequest, res) => {
      const actor = req.authMember!;
      const user = req.authUser!;
      if (actor.role !== 'HOST' && actor.role !== 'ADMIN') {
        res
          .status(403)
          .json({ error: 'Only a group Host or Admin can update reminder settings.' });
        return;
      }

      const { quietHoursStart, quietHoursEnd, reminderCooldownHours } =
        req.body as {
          quietHoursStart?: number;
          quietHoursEnd?: number;
          reminderCooldownHours?: number;
        };

      const qStart = Number(quietHoursStart);
      const qEnd = Number(quietHoursEnd);
      const cooldown = Number(reminderCooldownHours);

      if (
        !Number.isInteger(qStart) ||
        qStart < 0 ||
        qStart > 23 ||
        !Number.isInteger(qEnd) ||
        qEnd < 0 ||
        qEnd > 23 ||
        !Number.isInteger(cooldown) ||
        cooldown < 1 ||
        cooldown > 168
      ) {
        res.status(400).json({ error: 'Invalid quiet hours or cooldown hours.' });
        return;
      }

      const now = new Date().toISOString();
      db.transaction(() => {
        db.prepare(
          `UPDATE groups SET quiet_hours_start = ?, quiet_hours_end = ?, reminder_cooldown_hours = ? WHERE id = ?`,
        ).run(qStart, qEnd, cooldown, actor.groupId);

        appendAuditLog(db, {
          groupId: actor.groupId,
          actorMemberId: actor.memberId,
          actionType: 'REMINDER_SETTINGS_UPDATED',
          entityType: 'GROUP',
          entityId: actor.groupId,
          payload: { quietHoursStart: qStart, quietHoursEnd: qEnd, cooldownHours: cooldown },
          createdAt: now,
        });
      })();

      res.json({
        state: buildGroupState(actor.groupId, user.userId, actor.memberId),
      });
    },
  );

  app.post(
    '/api/groups/:groupId/reminders/snooze',
    requireAuth,
    requireGroupMember,
    (req: AuthenticatedRequest, res) => {
      const actor = req.authMember!;
      const user = req.authUser!;
      const hours = Number((req.body as { hours?: number }).hours ?? 12);
      if (!Number.isInteger(hours) || hours < 0 || hours > 168) {
        res.status(400).json({ error: 'Snooze hours must be between 0 and 168.' });
        return;
      }

      const now = new Date();
      const snoozedUntil =
        hours === 0
          ? null
          : new Date(now.getTime() + hours * 3600 * 1000).toISOString();

      db.transaction(() => {
        db.prepare(`UPDATE group_members SET snoozed_until = ? WHERE id = ?`).run(
          snoozedUntil,
          actor.memberId,
        );

        appendAuditLog(db, {
          groupId: actor.groupId,
          actorMemberId: actor.memberId,
          actionType: hours === 0 ? 'REMINDER_UNSNOOZED' : 'REMINDER_SNOOZED',
          entityType: 'MEMBER',
          entityId: actor.memberId,
          payload: { hours, snoozedUntil },
          createdAt: now.toISOString(),
        });
      })();

      res.json({
        state: buildGroupState(actor.groupId, user.userId, actor.memberId),
      });
    },
  );

  app.post(
    '/api/groups/:groupId/reminders/send',
    requireAuth,
    requireGroupMember,
    (req: AuthenticatedRequest, res) => {
      const actor = req.authMember!;
      const user = req.authUser!;
      if (actor.role !== 'HOST' && actor.role !== 'ADMIN') {
        res.status(403).json({
          error: 'Only a group Host or Admin can send summary reminders.',
        });
        return;
      }

      const stateBefore = buildGroupState(actor.groupId, user.userId, actor.memberId);
      const now = new Date();
      const results: Array<{
        memberId: number;
        name: string;
        status: 'SENT' | 'SUPPRESSED';
        reason: string;
        summaryText?: string;
      }> = [];

      try {
        db.transaction(() => {
          for (const member of stateBefore.members) {
            const net = stateBefore.balances.netBalances.find(
              (n) => n.memberId === member.memberId,
            );
            if (!net || net.netMinor >= 0) continue;

            const evalRes = evaluateReminderEligibility(
              stateBefore.group.quietHoursStart,
              stateBefore.group.quietHoursEnd,
              stateBefore.group.reminderCooldownHours,
              member.snoozedUntil,
              member.lastRemindedAt,
              now,
            );

            if (!evalRes.eligible) {
              results.push({
                memberId: member.memberId,
                name: member.name,
                status: 'SUPPRESSED',
                reason: evalRes.reason,
              });
              continue;
            }

            const transfers = stateBefore.balances.simplifiedPlan
              .filter((t) => t.fromMemberId === member.memberId)
              .map((t) => `${formatMinorToPkr(t.amountMinor)} to ${t.toName}`);

            const summaryText = `Summary for ${member.name}: Total owed ${formatMinorToPkr(Math.abs(net.netMinor))} (${transfers.join(', ')})`;

            verificationProvider.sendBatchSummary({
              recipientLabel: member.name,
              summaryText,
            });

            db.prepare(
              `UPDATE group_members SET last_reminded_at = ? WHERE id = ?`,
            ).run(now.toISOString(), member.memberId);

            results.push({
              memberId: member.memberId,
              name: member.name,
              status: 'SENT',
              reason: 'Summary reminder sent.',
              summaryText,
            });
          }

          appendAuditLog(db, {
            groupId: actor.groupId,
            actorMemberId: actor.memberId,
            actionType: 'REMINDER_BATCH_SENT',
            entityType: 'GROUP',
            entityId: actor.groupId,
            payload: {
              sentCount: results.filter((r) => r.status === 'SENT').length,
              suppressedCount: results.filter((r) => r.status === 'SUPPRESSED').length,
            },
            createdAt: now.toISOString(),
          });
        })();

        res.json({
          results,
          state: buildGroupState(actor.groupId, user.userId, actor.memberId),
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to send reminders.';
        res.status(400).json({ error: message });
      }
    },
  );

  app.use(
    (
      err: unknown,
      _req: Request,
      res: Response,
      _next: NextFunction,
    ): void => {
      if (err instanceof multer.MulterError) {
        const msg =
          err.code === 'LIMIT_FILE_SIZE'
            ? 'Receipt file exceeds the 3 MB size limit.'
            : 'Invalid receipt upload.';
        res.status(400).json({ error: msg });
        return;
      }
      if (
        err instanceof Error &&
        err.message.includes('Only JPG, PNG, WEBP, or PDF receipts')
      ) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Unexpected server error.' });
    },
  );

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve('dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FairShare Ledger listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start FairShare Ledger:', err);
  process.exit(1);
});
