import express from "express";
import cors from "cors";
import { authRoutes } from "./modules/auth";
import { roleRoutes } from "./modules/roles";
import { userRoutes } from "./modules/users";
import { livestreamRoute } from "./modules/livestream";
import { moduleRoutes } from "./modules/modules";
import { lessonRoutes } from "./modules/lessons";
import packageCourseRoutes from "./modules/package-courses/package-course.routes";
import { teacherProfileRoutes } from "./modules/teacher-profiles";
import ApiError from "./utils/ApiError";


const app = express();
app.use(express.json());
app.use((req, res, next) => {
    console.log(">>>", req.method, req.url);
    next();
});

app.use(cors({
    origin: "http://localhost:3000",
    credentials: true,
}));

app.use("/api/users", userRoutes);
app.use("/api/roles", roleRoutes);
app.use("/api/modules", moduleRoutes);
app.use("/api/lessons", lessonRoutes);
app.use("/api/package-courses", packageCourseRoutes);
app.use("/api/teacher-profiles", teacherProfileRoutes);
app.use("/livestreams", livestreamRoute);
app.use("/api/auth", authRoutes)

app.use((_req, _res, next) => {
    next(new ApiError("Not found", 404));
});

app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const statusCode = Number(error?.statusCode) || 500;
    const message = statusCode >= 500 && process.env.NODE_ENV === "production"
        ? "Internal server error"
        : (error?.message || "Internal server error");
    res.status(statusCode).json({ success: false, message });
});

export default app;
