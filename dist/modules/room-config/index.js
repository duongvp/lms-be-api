"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.roomConfigRepository = exports.roomConfigService = exports.roomConfigRoutes = void 0;
var room_config_routes_1 = require("./room-config.routes");
Object.defineProperty(exports, "roomConfigRoutes", { enumerable: true, get: function () { return __importDefault(room_config_routes_1).default; } });
var room_config_service_1 = require("./room-config.service");
Object.defineProperty(exports, "roomConfigService", { enumerable: true, get: function () { return __importDefault(room_config_service_1).default; } });
var room_config_repository_1 = require("./room-config.repository");
Object.defineProperty(exports, "roomConfigRepository", { enumerable: true, get: function () { return __importDefault(room_config_repository_1).default; } });
