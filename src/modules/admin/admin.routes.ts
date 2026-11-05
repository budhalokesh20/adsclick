import { Router } from 'express';
import { adminAuth, requireAdmin } from '../../middleware/admin-auth.js';
import { adminLimiter } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { z } from 'zod';
import { adminController } from './admin.controller.js';
import { prisma } from '../../database/prisma.js';
import { audit } from './audit.js';
import { adminApprove, adminPay, adminProcess, adminReject, adminReview } from '../withdrawals/withdrawals.service.js';
import { badRequest, notFound } from '../../utils/errors.js';

export const adminRouter = Router();

adminRouter.use(adminLimiter);

const body = (schema: z.ZodTypeAny) => validate({ body: schema });

// Auth (no role required; login verifies active admin)
adminRouter.post('/auth/login', body(z.object({ email: z.string().email(), password: z.string().min(1) })), adminController.login);
adminRouter.get('/auth/me', adminAuth, adminController.me);
adminRouter.patch('/auth/me', adminAuth, adminController.updateOwnProfile);
adminRouter.patch('/auth/password', adminAuth, adminController.changeOwnPassword);

// Overview — analytics read
adminRouter.get('/overview', requireAdmin(['analytics.read']), adminController.overview);
adminRouter.get('/trends', requireAdmin(['analytics.read']), adminController.trends);

// Users — support+
adminRouter.get('/users', requireAdmin(['users.read']), adminController.users);
adminRouter.post('/users', requireAdmin(['users.manage']), adminController.createUser);
adminRouter.get('/users/:id', requireAdmin(['users.read']), adminController.userDetail);
adminRouter.patch('/users/:id', requireAdmin(['users.manage']), adminController.updateUser);
adminRouter.patch('/users/:id/status', requireAdmin(['users.manage']), body(z.object({ status: z.string() })), adminController.userStatus);
adminRouter.delete('/users/:id', requireAdmin(['users.manage']), adminController.deleteUser);

// Providers & campaigns — finance+
adminRouter.get('/providers', requireAdmin(['finance.read']), adminController.providers);
adminRouter.post('/providers', requireAdmin(['finance.write']), adminController.createProvider);
adminRouter.patch('/providers/:id', requireAdmin(['finance.write']), adminController.updateProvider);
adminRouter.get('/providers/:id/campaigns', requireAdmin(['finance.read']), adminController.campaigns);
adminRouter.post('/providers/:id/campaigns', requireAdmin(['finance.write']), adminController.createCampaign);
adminRouter.patch('/campaigns/:id', requireAdmin(['finance.write']), adminController.updateCampaign);

// Ad event / impression views — analytics read
adminRouter.get('/events', requireAdmin(['analytics.read']), adminController.events);
adminRouter.get('/impressions/verified', requireAdmin(['analytics.read']), adminController.impressions);

// Finance — finance role
adminRouter.get('/finance/summary', requireAdmin(['finance.read']), adminController.financeSummary);
adminRouter.get('/finance/allocations', requireAdmin(['finance.read']), adminController.allocations);
adminRouter.get('/finance/ledger', requireAdmin(['finance.read']), adminController.ledger);
adminRouter.get('/finance/reconciliation', requireAdmin(['finance.read']), adminController.reconcile);
adminRouter.post('/finance/adj', requireAdmin(['finance.write']), adminController.adjust);
adminRouter.get('/payout-methods', requireAdmin(['finance.read']), adminController.payoutMethods);
adminRouter.get('/countries', requireAdmin(['finance.read']), adminController.countries);
adminRouter.post('/payout-methods', requireAdmin(['finance.write']), adminController.createPayoutMethod);
adminRouter.patch('/payout-methods/:id', requireAdmin(['finance.write']), adminController.updatePayoutMethod);
adminRouter.delete('/payout-methods/:id', requireAdmin(['finance.write']), adminController.removePayoutMethod);

// Withdrawals — finance
adminRouter.get('/withdrawals', requireAdmin(['finance.read']), adminController.withdrawals);
adminRouter.get('/withdrawals/:id', requireAdmin(['finance.read']), adminController.withdrawalDetail);
adminRouter.post('/withdrawals/:id/review', requireAdmin(['withdrawals.manage']), withdrawalAction(adminReview));
adminRouter.post('/withdrawals/:id/approve', requireAdmin(['withdrawals.manage']), withdrawalAction(adminApprove));
adminRouter.post('/withdrawals/:id/process', requireAdmin(['withdrawals.manage']), withdrawalAction(adminProcess));
adminRouter.post('/withdrawals/:id/pay', requireAdmin(['withdrawals.manage']), withdrawalAction(adminPay));
adminRouter.post('/withdrawals/:id/reject', requireAdmin(['withdrawals.manage']), withdrawalAction(adminReject));

// Fraud — support+
adminRouter.get('/fraud/events', requireAdmin(['users.read']), adminController.fraudEvents);
adminRouter.patch('/fraud/events/:id', requireAdmin(['fraud.manage']), adminController.resolveFraud);

// Settings — finance/audit; admins & audit logs — super
adminRouter.get('/settings', requireAdmin(['finance.read']), adminController.settings);
adminRouter.put('/settings/:key', requireAdmin(['settings.finance']), adminController.updateSetting);
adminRouter.get('/admins', requireAdmin(['*']), adminController.admins);
adminRouter.post('/admins', requireAdmin(['*']), adminController.createAdmin);
adminRouter.patch('/admins/:id/role', requireAdmin(['*']), adminController.setAdminRole);
adminRouter.get('/roles', requireAdmin(['*']), adminController.roles);
adminRouter.get('/audit-logs', requireAdmin(['*']), adminController.auditLogs);

function withdrawalAction(action: (id: string, adminId: string, note?: string) => Promise<void>) {
  return async (req: { params: { id: string }; admin?: { adminId: string }; body: { note?: string }; ip?: string; path: string }, res: { json: (v: unknown) => void; status: (code: number) => { send: () => void } }) => {
    if (!req.admin?.adminId) throw badRequest('ADMIN_REQUIRED', 'Admin session required');
    const id = req.params.id;
    const request = await prisma.withdrawalRequest.findUnique({ where: { id }, select: { status: true } });
    if (!request) throw notFound('Withdrawal not found');
    await action(id, req.admin.adminId, req.body?.note);
    await audit(req as never, `withdrawals.${req.path.split('/').pop()}`, 'withdrawal_requests', id, { status: request.status }, {});
    res.json({ ok: true, id });
  };
}
