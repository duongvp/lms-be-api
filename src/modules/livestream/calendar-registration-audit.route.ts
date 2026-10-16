import { Router } from 'express';
import authMiddleware from '../auth/auth.middleware';
import { getProgramScopeFilter } from '../../services/authorization.service';
import { startRegistrationAudit, getRegistrationAudit, applyRegistrationAudit } from './calendar-registration-audit.service';

const router = Router();
// Mounted under the authenticated calendar router. Check the same update
// permission as student sync, then independently enforce raw program scopes.
router.use(authMiddleware.authorize(['calendar.update']));
router.post('/', async (req, res, next) => {
  try {
    const data = await startRegistrationAudit(req.body?.ids, req.body?.registered_at,
      Number(req.user?.userId), getProgramScopeFilter(req.user, 'calendar.update'));
    res.status(202).json({success: true, data});
  } catch (error) { next(error); }
});
router.get('/:jobId', (req, res, next) => {
  try {
    const data = getRegistrationAudit(String(req.params.jobId), Number(req.user?.userId),
      getProgramScopeFilter(req.user, 'calendar.update'), req.query.page ?? 1, req.query.limit ?? 50);
    res.json({success: true, data});
  } catch (error) { next(error); }
});
router.post('/:jobId/apply', (req, res, next) => {
  try {
    const data = applyRegistrationAudit(String(req.params.jobId), Number(req.user?.userId), getProgramScopeFilter(req.user, 'calendar.update'));
    res.status(202).json({success: true, data});
  } catch (error) { next(error); }
});
export default router;
