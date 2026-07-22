import express from "express";
import cors from "cors";
import { authRoutes } from "./modules/auth";
import { roleRoutes } from "./modules/roles";
import { userRoutes } from "./modules/users";
import { livestreamRoute } from "./modules/livestream";


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
app.use("/livestreams", livestreamRoute);
app.use("/api/auth", authRoutes)

export default app;