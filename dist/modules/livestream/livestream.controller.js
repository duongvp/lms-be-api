"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCalendar = exports.cancelSession = exports.updateSchedule = exports.updateBulk = exports.createBulk = exports.createSingle = void 0;
const livestreamService = __importStar(require("./livestream.service"));
const createSingle = async (req, res, next) => {
    try {
        console.log(req.body);
        const result = await livestreamService.createSingle(req.body);
        res.status(201).json({ success: true, data: result });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.createSingle = createSingle;
const createBulk = async (req, res, next) => {
    try {
        const result = await livestreamService.createBulk(req.body);
        res.status(201).json({ success: true, data: result });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.createBulk = createBulk;
// Hàm mới: Cập nhật nhiều lịch học cùng lúc (Bulk Update)
const updateBulk = async (req, res, next) => {
    try {
        const result = await livestreamService.updateBulk(req.body);
        res.status(200).json({ success: true, data: result });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.updateBulk = updateBulk;
const updateSchedule = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { update_mode, ...data } = req.body;
        const result = await livestreamService.updateSchedule(Number(id), data, update_mode);
        res.status(200).json({ success: true, data: result });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.updateSchedule = updateSchedule;
const cancelSession = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await livestreamService.cancelSession(Number(id));
        res.status(200).json({ success: true, data: result });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.cancelSession = cancelSession;
const getCalendar = async (req, res, next) => {
    try {
        const result = await livestreamService.getCalendar(req.query);
        res.status(200).json({ success: true, data: result });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.getCalendar = getCalendar;
