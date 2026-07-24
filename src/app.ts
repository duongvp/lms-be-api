import express from "express";
import cors from "cors";
import { authRoutes } from "./modules/auth";
import { roleRoutes } from "./modules/roles";
import { userRoutes } from "./modules/users";
import { livestreamRoute } from "./modules/livestream";
import { moduleRoutes } from "./modules/modules";
import { lessonRoutes } from "./modules/lessons";


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
app.use("/livestreams", livestreamRoute);
app.use("/api/auth", authRoutes)

export default app;
