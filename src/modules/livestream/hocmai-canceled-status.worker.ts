import { releaseReadyCanceledStatuses } from './hocmai-canceled-status.service';
import { logger } from '../../utils/logger';

// This gate never calls HMO and never consumes/retries status=0/2/3 jobs.
// It only opens status=4 prerequisites after the other project's worker ack.
export const createCanceledStatusCheck = (release = releaseReadyCanceledStatuses) => {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try { await release(); }
    catch (error) { logger.error('[HmoCanceledStatus] Không thể mở yêu cầu nghỉ học đang chờ:', error); }
    finally { running = false; }
  };
};

let started = false;
export const startCanceledStatusGate = () => {
  if (started || process.env.HOCMAI_CANCELED_STATUS_GATE_ENABLED === 'false') return () => {};
  started = true;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const check = createCanceledStatusCheck();
  const tick = async () => {
    if (stopped) return;
    await check();
    if (!stopped) timer = setTimeout(() => { void tick(); }, 15_000);
  };
  void tick();
  return () => { stopped = true; if (timer) clearTimeout(timer); started = false; };
};
