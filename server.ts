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
  seedDemoData,
  verifyPassword,
} from './server/db.ts';
import {
  computeEqualSplits,
  computeGroupBalances,
  evaluateReminderEligibility,
  formatPaisaToPkr,
  parsePkrToPaisa,
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

// Seed realistic PKR demo data on initial boot if empty
const existingGroupCount = db
  .prepare('SELECT COUNT(*) AS cnt FROM groups')
  .get() as { cnt: number };
if (existingGroupCount.cnt === 0) {
  seedDemoData(db, verificationProvider);
}

interface SessionPayload {
  userId: number;
  memberId: number;
  groupId: number;
  exp: number;
}

function signSessionToken(payload: Omit<SessionPayload, 'exp'>): string {
  const fullPayload: SessionPayload = {
    ...payload,
    exp: Date.now() + 7 * 24 * 3600 * 1000,
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
    if (!parsed || typeof parsed.memberId !== 'number' || parsed.exp < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

interface AuthenticatedRequest extends Request {
  authMember?: MemberRecord & { groupId: number };
}

function loadActiveGroupId(): number {
  const row = db
    .prepare('SELECT id FROM groups ORDER BY id ASC LIMIT 1')
    .get() as { id: number } | undefined;
  if (!row) {
    return seedDemoData(db, verificationProvider).groupId;
  }
  return row.id;
}

function loadGroupMemberById(memberId: number): (MemberRecord & { groupId: number }) | null {
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
  return {
    ...row,
    isShadow: row.isShadow === 1,
  };
}

function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const token = header.slice(7).trim();
  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Session expired or invalid.' });
    return;
  }
  const member = loadGroupMemberById(payload.memberId);
  if (!member || member.userId !== payload.userId || member.isShadow) {
    res.status(401).json({ error: 'Active claimed account required.' });
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

function buildFullState(actorMemberId?: number | null) {
  const groupId = loadActiveGroupId();
  const group = db
    .prepare(
      `SELECT id, name, currency_code AS currencyCode, quiet_hours_start AS quietHoursStart,
              quiet_hours_end AS quietHoursEnd, reminder_cooldown_hours AS reminderCooldownHours,
              created_at AS createdAt
       FROM groups WHERE id = ?`,
    )
    .get(groupId) as {
    id: number;
    name: string;
    currencyCode: string;
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
    demoEnvironment: true,
    verificationMode: verificationProvider.mode,
    devTokens:
      verificationProvider.mode === 'dev_mock'
        ? verificationProvider.getActiveDevTokens()
        : [],
    currentMemberId: actorMemberId ?? null,
    group,
    members,
    expenses: enrichedExpenses,
    settlements: enrichedSettlements,
    balances,
    reminderStatuses,
    auditLogs,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, verificationMode: verificationProvider.mode });
  });

  app.get('/api/state', (req: AuthenticatedRequest, res) => {
    let currentMemberId: number | null = null;
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
      const payload = verifySessionToken(header.slice(7).trim());
      if (payload) {
        const m = loadGroupMemberById(payload.memberId);
        if (m && !m.isShadow) {
          currentMemberId = m.memberId;
        }
      }
    }
    res.json(buildFullState(currentMemberId));
  });

  app.post('/api/auth/demo-switch', (req, res) => {
    const { memberId } = req.body as { memberId?: number };
    if (!Number.isInteger(memberId)) {
      res.status(400).json({ error: 'Valid memberId is required.' });
      return;
    }
    const member = loadGroupMemberById(Number(memberId));
    if (!member) {
      res.status(404).json({ error: 'Member not found.' });
      return;
    }
    if (member.isShadow) {
      res.status(403).json({
        error:
          'Shadow members have not claimed an account yet. Use the Shadow Claim screen first.',
      });
      return;
    }
    const token = signSessionToken({
      userId: member.userId,
      memberId: member.memberId,
      groupId: member.groupId,
    });
    res.json({ token, member });
  });

  app.post('/api/auth/login', (req, res) => {
    const { handle, password } = req.body as {
      handle?: string;
      password?: string;
    };
    if (!handle || !password) {
      res.status(400).json({ error: 'Handle and password are required.' });
      return;
    }
    const cleanHandle = handle.trim().replace(/^@/, '').toLowerCase();
    const row = db
      .prepare(
        `SELECT u.id AS userId, u.password_hash AS passwordHash, u.is_shadow AS isShadow,
                gm.id AS memberId, gm.group_id AS groupId
         FROM users u
         JOIN group_members gm ON gm.user_id = u.id
         WHERE LOWER(u.handle) = ?
         LIMIT 1`,
      )
      .get(cleanHandle) as
      | {
          userId: number;
          passwordHash: string | null;
          isShadow: number;
          memberId: number;
          groupId: number;
        }
      | undefined;

    if (!row || row.isShadow === 1 || !row.passwordHash) {
      res.status(401).json({ error: 'Invalid handle or password.' });
      return;
    }
    if (!verifyPassword(password, row.passwordHash)) {
      res.status(401).json({ error: 'Invalid handle or password.' });
      return;
    }

    const token = signSessionToken({
      userId: row.userId,
      memberId: row.memberId,
      groupId: row.groupId,
    });
    const member = loadGroupMemberById(row.memberId);
    res.json({ token, member });
  });

  app.get('/api/receipts/:filename', (req, res) => {
    const rawName = path.basename(req.params.filename || '');
    const resolved = path.resolve(UPLOADS_DIR, rawName);
    if (!resolved.startsWith(UPLOADS_DIR + path.sep)) {
      res.status(400).json({ error: 'Invalid receipt path.' });
      return;
    }
    if (!fs.existsSync(resolved)) {
      res.status(404).json({ error: 'Receipt not found.' });
      return;
    }
    res.sendFile(resolved);
  });

  app.post(
    '/api/expenses',
    requireAuth,
    upload.single('receipt'),
    (req: AuthenticatedRequest, res) => {
      try {
        const actor = req.authMember!;
        const body = req.body as Record<string, unknown>;
        const title = String(body.title ?? '').trim();
        const category = String(body.category ?? 'General').trim() || 'General';
        const splitMode = String(body.splitMode ?? 'EQUAL') as 'EQUAL' | 'CUSTOM';
        const paidByMemberId = Number(body.paidByMemberId ?? actor.memberId);

        if (!title || title.length > 120) {
          res.status(400).json({ error: 'Title is required (max 120 chars).' });
          return;
        }
        if (splitMode !== 'EQUAL' && splitMode !== 'CUSTOM') {
          res.status(400).json({ error: 'splitMode must be EQUAL or CUSTOM.' });
          return;
        }

        const totalMinor = parsePkrToPaisa(
          typeof body.amountPkr === 'string' || typeof body.amountPkr === 'number'
            ? body.amountPkr
            : String(body.totalMinor ? Number(body.totalMinor) / 100 : ''),
        );

        const groupMembers = db
          .prepare(
            `SELECT id FROM group_members WHERE group_id = ?`,
          )
          .all(actor.groupId) as Array<{ id: number }>;
        const validMemberSet = new Set(groupMembers.map((m) => m.id));

        if (!validMemberSet.has(paidByMemberId)) {
          res.status(400).json({ error: 'Payer must belong to this group.' });
          return;
        }

        let resolvedSplits: Array<{ memberId: number; amountMinor: number }>;
        if (splitMode === 'EQUAL') {
          const rawIds =
            typeof body.participantMemberIds === 'string'
              ? (JSON.parse(body.participantMemberIds) as number[])
              : (body.participantMemberIds as number[]);
          if (!Array.isArray(rawIds) || rawIds.length === 0) {
            res
              .status(400)
              .json({ error: 'Select at least one participant to split equally.' });
            return;
          }
          for (const id of rawIds) {
            if (!validMemberSet.has(Number(id))) {
              res.status(400).json({ error: 'Invalid participant selected.' });
              return;
            }
          }
          resolvedSplits = computeEqualSplits(
            totalMinor,
            rawIds.map((id) => Number(id)),
          );
        } else {
          const rawCustom =
            typeof body.customSplits === 'string'
              ? (JSON.parse(body.customSplits) as Array<{
                  memberId: number;
                  amountMinor: number;
                }>)
              : (body.customSplits as Array<{
                  memberId: number;
                  amountMinor: number;
                }>);
          if (!Array.isArray(rawCustom)) {
            res.status(400).json({ error: 'customSplits array is required.' });
            return;
          }
          for (const item of rawCustom) {
            if (!validMemberSet.has(Number(item.memberId))) {
              res.status(400).json({ error: 'Invalid participant in custom split.' });
              return;
            }
          }
          resolvedSplits = validateCustomSplits(
            totalMinor,
            rawCustom.map((item) => ({
              memberId: Number(item.memberId),
              amountMinor: Number(item.amountMinor),
            })),
          );
        }

        const receiptPath = req.file ? `/api/receipts/${req.file.filename}` : null;
        const now = new Date().toISOString();

        const tx = db.transaction(() => {
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
              totalMinor,
              splitMode,
              paidByMemberId,
              splitCount: resolvedSplits.length,
              hasReceipt: Boolean(receiptPath),
            },
            createdAt: now,
          });

          return expId;
        });

        const expenseId = tx();
        res.status(201).json({
          expenseId,
          state: buildFullState(actor.memberId),
        });
      } catch (err) {
        if (req.file) {
          fs.rmSync(req.file.path, { force: true });
        }
        const message = err instanceof Error ? err.message : 'Failed to create expense.';
        res.status(400).json({ error: message });
      }
    },
  );

  app.post('/api/expenses/:id/void', requireAuth, (req: AuthenticatedRequest, res) => {
    const actor = req.authMember!;
    const expenseId = Number(req.params.id);
    const reason = String((req.body as { reason?: string }).reason ?? '').trim();

    if (!Number.isInteger(expenseId) || expenseId <= 0) {
      res.status(400).json({ error: 'Invalid expense ID.' });
      return;
    }
    if (!reason || reason.length < 3) {
      res.status(400).json({ error: 'A void reason (at least 3 characters) is required.' });
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
      res.status(404).json({ error: 'Expense not found.' });
      return;
    }
    if (expense.status === 'VOIDED') {
      res.status(409).json({ error: 'Expense is already voided.' });
      return;
    }

    const canVoid =
      actor.role === 'HOST' ||
      actor.role === 'ADMIN' ||
      actor.memberId === expense.paidByMemberId;

    if (!canVoid) {
      res.status(403).json({
        error: `Permission denied: ${actor.role} cannot void another member's expense. Only the payer, ADMIN, or HOST may void.`,
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
          totalMinor: expense.totalMinor,
          reason,
        },
        createdAt: now,
      });
    })();

    res.json({ state: buildFullState(actor.memberId) });
  });

  app.post(
    '/api/settlements',
    requireAuth,
    upload.single('receipt'),
    (req: AuthenticatedRequest, res) => {
      try {
        const actor = req.authMember!;
        const body = req.body as Record<string, unknown>;
        const fromMemberId = Number(body.fromMemberId ?? actor.memberId);
        const toMemberId = Number(body.toMemberId);
        const note = String(body.note ?? '').trim() || null;

        if (!Number.isInteger(fromMemberId) || !Number.isInteger(toMemberId)) {
          res.status(400).json({ error: 'Valid sender and recipient are required.' });
          return;
        }
        if (fromMemberId === toMemberId) {
          res.status(400).json({ error: 'Sender and recipient cannot be the same member.' });
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
          res.status(400).json({ error: 'Both members must belong to this group.' });
          return;
        }

        const canInitiate =
          actor.memberId === fromMemberId ||
          actor.role === 'HOST' ||
          actor.role === 'ADMIN';
        if (!canInitiate) {
          res.status(403).json({
            error: 'Members can only initiate settlements from their own account.',
          });
          return;
        }

        const amountMinor = parsePkrToPaisa(String(body.amountPkr ?? ''));
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
              amountMinor,
              note,
              hasReceipt: Boolean(receiptPath),
            },
            createdAt: now,
          });

          return stId;
        })();

        res.status(201).json({
          settlementId,
          state: buildFullState(actor.memberId),
        });
      } catch (err) {
        if (req.file) {
          fs.rmSync(req.file.path, { force: true });
        }
        const message =
          err instanceof Error ? err.message : 'Failed to record settlement.';
        res.status(400).json({ error: message });
      }
    },
  );

  app.post(
    '/api/settlements/:id/confirm',
    requireAuth,
    (req: AuthenticatedRequest, res) => {
      const actor = req.authMember!;
      const settlementId = Number(req.params.id);
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
        res.status(404).json({ error: 'Settlement not found.' });
        return;
      }
      if (st.status !== 'PENDING_CONFIRMATION') {
        res
          .status(409)
          .json({ error: `Cannot confirm settlement in state ${st.status}.` });
        return;
      }

      if (actor.memberId === st.fromMemberId && actor.role === 'MEMBER') {
        res.status(403).json({
          error: 'Sender cannot confirm their own payment.',
        });
        return;
      }

      const canConfirm =
        actor.memberId === st.toMemberId ||
        actor.role === 'HOST' ||
        actor.role === 'ADMIN';
      if (!canConfirm) {
        res.status(403).json({
          error:
            'Only the payment recipient, ADMIN, or HOST can confirm this settlement.',
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
            amountMinor: st.amountMinor,
          },
          createdAt: now,
        });
      })();

      res.json({ state: buildFullState(actor.memberId) });
    },
  );

  app.post(
    '/api/settlements/:id/reject',
    requireAuth,
    (req: AuthenticatedRequest, res) => {
      const actor = req.authMember!;
      const settlementId = Number(req.params.id);
      const reason = String((req.body as { reason?: string }).reason ?? '').trim();

      if (!reason || reason.length < 3) {
        res
          .status(400)
          .json({ error: 'A rejection reason (at least 3 characters) is required.' });
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
        res.status(404).json({ error: 'Settlement not found.' });
        return;
      }
      if (st.status !== 'PENDING_CONFIRMATION') {
        res
          .status(409)
          .json({ error: `Cannot reject settlement in state ${st.status}.` });
        return;
      }

      const canReject =
        actor.memberId === st.toMemberId ||
        actor.role === 'HOST' ||
        actor.role === 'ADMIN';
      if (!canReject) {
        res.status(403).json({
          error:
            'Only the payment recipient, ADMIN, or HOST can reject this settlement.',
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
            amountMinor: st.amountMinor,
            reason,
          },
          createdAt: now,
        });
      })();

      res.json({ state: buildFullState(actor.memberId) });
    },
  );

  app.post(
    '/api/settlements/:id/cancel',
    requireAuth,
    (req: AuthenticatedRequest, res) => {
      const actor = req.authMember!;
      const settlementId = Number(req.params.id);
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
        res.status(404).json({ error: 'Settlement not found.' });
        return;
      }
      if (st.status !== 'PENDING_CONFIRMATION') {
        res
          .status(409)
          .json({ error: `Cannot cancel settlement in state ${st.status}.` });
        return;
      }

      const canCancel =
        actor.memberId === st.fromMemberId ||
        actor.role === 'HOST' ||
        actor.role === 'ADMIN';
      if (!canCancel) {
        res.status(403).json({
          error: 'Only the sender, ADMIN, or HOST can cancel a pending settlement.',
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
            amountMinor: st.amountMinor,
          },
          createdAt: now,
        });
      })();

      res.json({ state: buildFullState(actor.memberId) });
    },
  );

  app.post('/api/shadow/invite', requireAuth, (req: AuthenticatedRequest, res) => {
    const actor = req.authMember!;
    if (actor.role !== 'HOST' && actor.role !== 'ADMIN') {
      res.status(403).json({
        error: 'Only HOST or ADMIN can add shadow (ghost) members.',
      });
      return;
    }

    const name = String((req.body as { name?: string }).name ?? '').trim();
    if (!name || name.length < 2 || name.length > 60) {
      res.status(400).json({ error: 'Member name must be 2–60 characters.' });
      return;
    }

    try {
      const tokenRecord = verificationProvider.issueToken({
        purpose: 'SHADOW_CLAIM',
        recipientLabel: `${name} (Shadow)`,
        detail: `Single-use claim token created by ${actor.name}`,
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
          actionType: 'SHADOW_MEMBER_INVITED',
          entityType: 'USER',
          entityId: userId,
          payload: {
            name,
            memberId,
            tokenExpiresAt: tokenRecord.expiresAt,
          },
          createdAt: now,
        });

        return { userId, memberId };
      })();

      res.status(201).json({
        memberId: result.memberId,
        claimToken:
          verificationProvider.mode === 'dev_mock' ? tokenRecord.token : null,
        expiresAt: tokenRecord.expiresAt,
        state: buildFullState(actor.memberId),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to invite shadow member.';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/shadow/claim', (req, res) => {
    const { claimToken, handle, password, displayName } = req.body as {
      claimToken?: string;
      handle?: string;
      password?: string;
      displayName?: string;
    };

    const rawToken = String(claimToken ?? '').trim();
    const cleanHandle = String(handle ?? '')
      .trim()
      .replace(/^@/, '')
      .toLowerCase();
    const rawPassword = String(password ?? '');

    if (!rawToken) {
      res.status(400).json({ error: 'Single-use claim token is required.' });
      return;
    }
    if (!/^[a-z0-9_]{3,24}$/.test(cleanHandle)) {
      res.status(400).json({
        error: 'Handle must be 3–24 lowercase letters, numbers, or underscores.',
      });
      return;
    }
    if (rawPassword.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters.' });
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
            'Claim token is invalid, expired, or has already been claimed.',
          );
        }
        if (userRow.isShadow !== 1 || userRow.claimedAt !== null) {
          throw new Error('This shadow account has already been claimed and locked.');
        }
        if (
          userRow.expiresAt &&
          new Date(userRow.expiresAt).getTime() <= Date.now()
        ) {
          throw new Error('This claim token has expired. Ask a HOST/ADMIN for a new invite.');
        }

        const handleConflict = db
          .prepare(`SELECT id FROM users WHERE LOWER(handle) = ? AND id != ?`)
          .get(cleanHandle, userRow.userId) as { id: number } | undefined;
        if (handleConflict) {
          throw new Error(`Handle @${cleanHandle} is already taken.`);
        }

        const updatedName =
          displayName && displayName.trim().length >= 2
            ? displayName.trim()
            : userRow.name;

        const updateResult = db
          .prepare(
            `UPDATE users
             SET name = ?, handle = ?, password_hash = ?, is_shadow = 0,
                 claim_token_hash = NULL, claim_token_expires_at = NULL, claimed_at = ?
             WHERE id = ? AND is_shadow = 1 AND claimed_at IS NULL`,
          )
          .run(updatedName, cleanHandle, hashPassword(rawPassword), now, userRow.userId);

        if (updateResult.changes !== 1) {
          throw new Error('Account claim conflict — takeover prevented.');
        }

        appendAuditLog(db, {
          groupId: userRow.groupId,
          actorMemberId: userRow.memberId,
          actionType: 'SHADOW_MEMBER_CLAIMED',
          entityType: 'USER',
          entityId: userRow.userId,
          payload: {
            name: updatedName,
            handle: cleanHandle,
            preservedMemberId: userRow.memberId,
          },
          createdAt: now,
        });

        return {
          userId: userRow.userId,
          memberId: userRow.memberId,
          groupId: userRow.groupId,
          name: updatedName,
        };
      })();

      verificationProvider.consumeToken(rawToken);
      const token = signSessionToken({
        userId: claimed.userId,
        memberId: claimed.memberId,
        groupId: claimed.groupId,
      });

      res.json({
        token,
        claimedMember: loadGroupMemberById(claimed.memberId),
        state: buildFullState(claimed.memberId),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to claim shadow account.';
      res.status(409).json({ error: message });
    }
  });

  app.patch(
    '/api/reminders/settings',
    requireAuth,
    (req: AuthenticatedRequest, res) => {
      const actor = req.authMember!;
      if (actor.role !== 'HOST' && actor.role !== 'ADMIN') {
        res
          .status(403)
          .json({ error: 'Only HOST or ADMIN can change reminder rules.' });
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
        res.status(400).json({ error: 'Invalid quiet hours or cooldown duration.' });
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
          payload: { qStart, qEnd, cooldown },
          createdAt: now,
        });
      })();

      res.json({ state: buildFullState(actor.memberId) });
    },
  );

  app.post('/api/reminders/snooze', requireAuth, (req: AuthenticatedRequest, res) => {
    const actor = req.authMember!;
    const hours = Number((req.body as { hours?: number }).hours ?? 12);
    if (!Number.isInteger(hours) || hours < 0 || hours > 168) {
      res.status(400).json({ error: 'Snooze duration must be 0–168 hours.' });
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

    res.json({ state: buildFullState(actor.memberId) });
  });

  app.post('/api/reminders/send', requireAuth, (req: AuthenticatedRequest, res) => {
    const actor = req.authMember!;
    if (actor.role !== 'HOST' && actor.role !== 'ADMIN') {
      res.status(403).json({
        error: 'Only HOST or ADMIN can dispatch batched summary reminders.',
      });
      return;
    }

    const { testHour } = req.body as { testHour?: number };
    const stateBefore = buildFullState(actor.memberId);
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
            typeof testHour === 'number' ? testHour : undefined,
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
            .map((t) => `${formatPaisaToPkr(t.amountMinor)} to ${t.toName}`);

          const summaryText = `Batched FairShare Summary for ${member.name}: Net owed ${formatPaisaToPkr(Math.abs(net.netMinor))} (${transfers.join(', ')})`;

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
            reason: 'Batched summary reminder logged.',
            summaryText,
          });
        }

        appendAuditLog(db, {
          groupId: actor.groupId,
          actorMemberId: actor.memberId,
          actionType: 'REMINDER_BATCH_PROCESSED',
          entityType: 'GROUP',
          entityId: actor.groupId,
          payload: {
            sentCount: results.filter((r) => r.status === 'SENT').length,
            suppressedCount: results.filter((r) => r.status === 'SUPPRESSED')
              .length,
            testedHour: typeof testHour === 'number' ? testHour : now.getHours(),
          },
          createdAt: now.toISOString(),
        });
      })();

      res.json({
        results,
        state: buildFullState(actor.memberId),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to send reminders.';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/demo/reset', (_req, res) => {
    // Clean uploaded receipts safely inside UPLOADS_DIR
    if (fs.existsSync(UPLOADS_DIR)) {
      for (const file of fs.readdirSync(UPLOADS_DIR)) {
        const target = path.resolve(UPLOADS_DIR, file);
        if (target.startsWith(UPLOADS_DIR + path.sep)) {
          fs.rmSync(target, { force: true });
        }
      }
    }

    const seeded = seedDemoData(db, verificationProvider);
    const hostRow = db
      .prepare(
        `SELECT gm.id AS memberId, gm.user_id AS userId, gm.group_id AS groupId
         FROM group_members gm
         WHERE gm.group_id = ? AND gm.role = 'HOST'
         LIMIT 1`,
      )
      .get(seeded.groupId) as {
      memberId: number;
      userId: number;
      groupId: number;
    };

    const token = signSessionToken(hostRow);
    res.json({
      token,
      member: loadGroupMemberById(hostRow.memberId),
      state: buildFullState(hostRow.memberId),
    });
  });

  // Express error handler (including multer validation errors)
  app.use(
    (
      err: unknown,
      _req: Request,
      res: Response,
      _next: NextFunction,
    ): void => {
      const message =
        err instanceof Error ? err.message : 'Unexpected server error.';
      res.status(400).json({ error: message });
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
    console.log(
      `FairShare Ledger running on http://0.0.0.0:${PORT} (verification=${verificationProvider.mode})`,
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start FairShare Ledger:', err);
  process.exit(1);
});
