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
const lessons_1 = require("./modules/lessons");
const package_course_routes_1 = __importDefault(require("./modules/package-courses/package-course.routes"));
const ApiError_1 = __importDefault(require("./utils/ApiError"));
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use((req, res, next) => {
    console.log(">>>", req.method, req.url);
    next();
});
app.use((0, cors_1.default)({
    origin: ["http://localhost:3000", "https://lms-fe-ten.vercel.app"],
    credentials: true,
}));
app.use("/api/users", users_1.userRoutes);
app.use("/api/roles", roles_1.roleRoutes);
app.use("/api/modules", modules_1.moduleRoutes);
app.use("/api/lessons", lessons_1.lessonRoutes);
app.use("/api/package-courses", package_course_routes_1.default);
app.use("/livestreams", livestream_1.livestreamRoute);
app.use("/api/auth", auth_1.authRoutes);
app.use((_req, _res, next) => {
    next(new ApiError_1.default("Not found", 404));
});
app.use((error, _req, res, _next) => {
    const statusCode = Number(error?.statusCode) || 500;
    const message = statusCode >= 500 && process.env.NODE_ENV === "production"
        ? "Internal server error"
        : (error?.message || "Internal server error");
    res.status(statusCode).json({ success: false, message });
});
exports.default = app;
