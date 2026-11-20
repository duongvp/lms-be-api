import { Router } from 'express';
import auth from '../auth/auth.middleware';
import { getProgramGroups, saveProgramSettings, saveLearningGroup, programCode, positiveId } from './learning-group.service';
const router = Router();
router.use(auth.authenticate);
router.param('code', (req, res, next, value) => {
  try { req.params.code = programCode(value); next(); }
  catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
});
const scope = (permission: string) => auth.authorizeProgram(permission, req => String(req.params.code));
const read = auth.authorizeProgramForAny(['calendar.view','calendar.create','calendar.update'], req => String(req.params.code));
const action = (fn: (req: any) => Promise<any>) => async (req: any, res: any) => {
  try { res.json({ success: true, data: await fn(req) }); }
  catch (e: any) { res.status(e.statusCode || 400).json({ success: false, message: e.message }); }
};
router.get('/:code', read, action(req => getProgramGroups(req.params.code)));
router.put('/:code/settings', scope('calendar.update'), action(req => saveProgramSettings(req.params.code, req.body)));
router.post('/:code/groups', scope('calendar.create'), action(req => saveLearningGroup(req.params.code, req.body)));
router.put('/:code/groups/:id', scope('calendar.update'), action(req => saveLearningGroup(req.params.code, req.body, positiveId(req.params.id))));
export default router;
