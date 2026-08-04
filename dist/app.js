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
const teacher_profiles_1 = require("./modules/teacher-profiles");
const quizzes_1 = require("./modules/quizzes");
const ApiError_1 = __importDefault(require("./utils/ApiError"));
const app = (0, express_1.default)();
app.set('json replacer', (_key, value) => (typeof value === 'bigint' ? value.toString() : value));
const allowedCorsOrigins = new Set((process.env.CORS_ORIGINS
    || 'https://lms-fe-ten.vercel.app,http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean));
app.use(express_1.default.json());
app.use((req, res, next) => {
    console.log(">>>", req.method, req.url);
    next();
});
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        // Requests without Origin come from server-to-server clients such as
        // the Next.js auth proxy.
        callback(null, !origin || allowedCorsOrigins.has(origin));
    },
    credentials: true,
}));
app.use("/api/users", users_1.userRoutes);
app.use("/api/roles", roles_1.roleRoutes);
app.use("/api/modules", modules_1.moduleRoutes);
app.use("/api/lessons", lessons_1.lessonRoutes);
app.use("/api/package-courses", package_course_routes_1.default);
app.use("/api/teacher-profiles", teacher_profiles_1.teacherProfileRoutes);
app.use("/api/quizzes", quizzes_1.quizRoutes);
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
