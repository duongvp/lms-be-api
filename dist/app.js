"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const auth_1 = require("./modules/auth");
const roles_1 = require("./modules/roles");
const users_1 = require("./modules/users");
const livestream_1 = require("./modules/livestream");
const modules_1 = require("./modules/modules");
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use((req, res, next) => {
    console.log(">>>", req.method, req.url);
    next();
});
app.use((0, cors_1.default)({
    origin: "http://localhost:3000",
    credentials: true,
}));
app.use("/api/users", users_1.userRoutes);
app.use("/api/roles", roles_1.roleRoutes);
app.use("/api/modules", modules_1.moduleRoutes);
app.use("/livestreams", livestream_1.livestreamRoute);
app.use("/api/auth", auth_1.authRoutes);
exports.default = app;
