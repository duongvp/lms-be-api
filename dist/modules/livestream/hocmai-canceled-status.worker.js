"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCanceledStatusGate = exports.createCanceledStatusCheck = void 0;
const hocmai_canceled_status_service_1 = require("./hocmai-canceled-status.service");
const logger_1 = require("../../utils/logger");
// This gate never calls HMO and never consumes/retries status=0/2/3 jobs.
// It only opens status=4 prerequisites after the other project's worker ack.
const createCanceledStatusCheck = (release = hocmai_canceled_status_service_1.releaseReadyCanceledStatuses) => {
    let running = false;
    return async () => {
        if (running)
            return;
        running = true;
        try {
            await release();
        }
        catch (error) {
            logger_1.logger.error('[HmoCanceledStatus] Không thể mở yêu cầu nghỉ học đang chờ:', error);
        }
        finally {
            running = false;
        }
    };
};
exports.createCanceledStatusCheck = createCanceledStatusCheck;
let started = false;
const startCanceledStatusGate = () => {
    if (started)
        return () => { };
    started = true;
    let stopped = false;
    let timer;
    const check = (0, exports.createCanceledStatusCheck)();
    const tick = async () => {
        if (stopped)
            return;
        await check();
        if (!stopped)
            timer = setTimeout(() => { void tick(); }, 15_000);
    };
    void tick();
    return () => { stopped = true; if (timer)
        clearTimeout(timer); started = false; };
};
exports.startCanceledStatusGate = startCanceledStatusGate;
