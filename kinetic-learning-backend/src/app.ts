import express from "express";
import cors from "cors";
import helmet from "helmet";
import prisma from "./lib/prisma.js";
import { allowedOrigins } from "./config/env.js";
import { createRateLimiter, errorHandler, notFoundHandler, requestContext } from "./middlewares/security.middleware.js";
import authRoutes from "./modules/auth/auth.routes.js";
import userRoutes from "./modules/users/user.routes.js";
import programRoutes from "./modules/programs/program.routes.js";
import courseRoutes from "./modules/courses/course.routes.js";
import learningRoutes from "./modules/learning/learning.routes.js";
import adminRoutes from "./modules/admin/admin.routes.js";
import enrollmentRoutes from "./modules/enrollments/enrollment.routes.js";
import assessmentRoutes from "./modules/assessments/assessment.routes.js";
import graduationRoutes from "./modules/learning/graduation.routes.js";
import tutorRoutes from "./modules/tutor/tutor.routes.js";
import gamificationRoutes from "./modules/gamification/gamification.routes.js";
import adminManagementRoutes from "./modules/admin/admin.management.routes.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(requestContext);
app.use(helmet());
const origins = allowedOrigins();
app.use(cors({
  origin(origin, callback) {
    if (!origin || origins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 60, prefix: "auth" });

app.get("/health", (_req, res) => res.status(200).json({ success: true, message: "Kinetic Learning API is running" }));
app.get("/health/db", async (_req, res) => {
  try { await prisma.$queryRaw`SELECT 1`; return res.status(200).json({ success: true, message: "Database connection is healthy" }); }
  catch (error) { console.error("Database health check failed:", error); return res.status(503).json({ success: false, message: "Database connection failed" }); }
});

app.use("/auth", authLimiter, authRoutes);
app.use("/tutor", tutorRoutes);
app.use("/", gamificationRoutes);
app.use("/me", userRoutes);
app.use("/programs", programRoutes);
app.use("/courses", courseRoutes);
app.use("/", learningRoutes);
app.use("/admin", adminRoutes);
app.use("/admin", adminManagementRoutes);
app.use("/", graduationRoutes);
app.use("/", enrollmentRoutes);
app.use("/", assessmentRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
export default app;
