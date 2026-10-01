import { createHash, createHmac, randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import prisma from "../../lib/prisma.js";
import { UserRole, UserStatus } from "../../generated/prisma/enums.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireAdmin } from "../../middlewares/admin.middleware.js";

const router = Router();
router.use(requireAuth, requireAdmin);

const getParam = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

const userUpdateSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().email().transform(v => v.toLowerCase()).optional(),
  role: z.enum(["STUDENT", "ADMIN"]).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  emailVerified: z.boolean().optional(),
}).strict().refine(v => Object.keys(v).length > 0, { message: "At least one field is required" });

router.get("/users", async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const role: UserRole | undefined = req.query.role === "ADMIN" ? UserRole.ADMIN : req.query.role === "STUDENT" ? UserRole.STUDENT : undefined;
    const status: UserStatus | undefined = req.query.status === "ACTIVE" ? UserStatus.ACTIVE : req.query.status === "SUSPENDED" ? UserStatus.SUSPENDED : undefined;
    const where = {
      ...(role ? { role } : {}), ...(status ? { status } : {}),
      ...(search ? { OR: [
        { firstName: { contains: search, mode: "insensitive" as const } },
        { lastName: { contains: search, mode: "insensitive" as const } },
        { email: { contains: search, mode: "insensitive" as const } },
      ] } : {}),
    };
    const [users, total] = await Promise.all([
      prisma.user.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: "desc" }, select: {
        id: true, firstName: true, lastName: true, email: true, role: true, status: true, emailVerified: true, createdAt: true, updatedAt: true,
        _count: { select: { enrollments: true, certificates: true, projectSubmissions: true, tutorSessions: true } },
      } }),
      prisma.user.count({ where }),
    ]);
    return res.json({ success: true, data: { users, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
  } catch (error) { console.error("Admin users error:", error); return res.status(500).json({ success: false, message: "Unable to load users" }); }
});

router.patch("/users/:id", async (req: any, res) => {
  const id = getParam(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "User ID is required" });
  const parsed = userUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors });
  if (id === req.userId && parsed.data.status === "SUSPENDED") return res.status(400).json({ success: false, message: "You cannot suspend your own admin account" });
  if (id === req.userId && parsed.data.role === "STUDENT") return res.status(400).json({ success: false, message: "You cannot remove your own admin role" });
  try {
    const user = await prisma.user.update({ where: { id }, data: parsed.data, select: { id: true, firstName: true, lastName: true, email: true, role: true, status: true, emailVerified: true, createdAt: true, updatedAt: true } });
    if (parsed.data.status === "SUSPENDED") await prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    return res.json({ success: true, message: "User updated", data: { user } });
  } catch (error: any) {
    if (error?.code === "P2025") return res.status(404).json({ success: false, message: "User not found" });
    if (error?.code === "P2002") return res.status(409).json({ success: false, message: "Email address is already in use" });
    console.error("Admin user update error:", error); return res.status(500).json({ success: false, message: "Unable to update user" });
  }
});

router.get("/analytics", async (_req, res) => {
  try {
    const [users, students, activeUsers, programs, publishedPrograms, activeEnrollments, completedEnrollments, certificates, pendingProjects, approvedProjects, tutorSessions, tutorMessages, xp, attempts, recentUsers, recentEnrollments] = await Promise.all([
      prisma.user.count(), prisma.user.count({ where: { role: "STUDENT" } }), prisma.user.count({ where: { status: "ACTIVE" } }),
      prisma.program.count(), prisma.program.count({ where: { isPublished: true } }), prisma.enrollment.count({ where: { status: "ACTIVE" } }),
      prisma.enrollment.count({ where: { status: "COMPLETED" } }), prisma.certificate.count(), prisma.projectSubmission.count({ where: { status: "PENDING_REVIEW" } }),
      prisma.projectSubmission.count({ where: { status: "APPROVED" } }), prisma.tutorSession.count(), prisma.tutorMessage.count(),
      prisma.xpEvent.aggregate({ _sum: { points: true } }),
      prisma.assessmentAttempt.aggregate({ where: { submittedAt: { not: null } }, _count: { _all: true }, _avg: { percentage: true } }),
      prisma.user.findMany({ take: 5, orderBy: { createdAt: "desc" }, select: { id: true, firstName: true, lastName: true, email: true, role: true, status: true, createdAt: true } }),
      prisma.enrollment.findMany({ take: 5, orderBy: { enrolledAt: "desc" }, include: { user: { select: { id: true, firstName: true, lastName: true } }, program: { select: { id: true, title: true } } } }),
    ]);
    return res.json({ success: true, data: {
      users: { total: users, students, active: activeUsers }, programs: { total: programs, published: publishedPrograms },
      enrollments: { active: activeEnrollments, completed: completedEnrollments }, learning: { certificates, totalXpAwarded: xp._sum.points ?? 0 },
      assessments: { submitted: attempts._count._all, averagePercentage: attempts._avg.percentage === null ? null : Math.round(attempts._avg.percentage * 10) / 10 },
      projects: { pendingReview: pendingProjects, approved: approvedProjects }, tutor: { sessions: tutorSessions, messages: tutorMessages },
      recent: { users: recentUsers, enrollments: recentEnrollments },
    } });
  } catch (error) { console.error("Admin analytics error:", error); return res.status(500).json({ success: false, message: "Unable to load analytics" }); }
});

const uploadSchema = z.object({ filename: z.string().trim().min(1).max(180), contentType: z.string().trim().min(3).max(120), size: z.number().int().positive().max(25 * 1024 * 1024) });
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();
const sha256 = (data: string) => createHash("sha256").update(data).digest("hex");

router.post("/uploads", async (req, res) => {
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "filename, contentType and size are required", errors: parsed.error.flatten().fieldErrors });
  const allowed = ["image/", "video/", "audio/", "application/pdf"];
  if (!allowed.some(v => parsed.data.contentType.startsWith(v))) return res.status(400).json({ success: false, message: "Unsupported upload content type" });
  const accountId = process.env.R2_ACCOUNT_ID, accessKey = process.env.R2_ACCESS_KEY_ID, secretKey = process.env.R2_SECRET_ACCESS_KEY, bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKey || !secretKey || !bucket) return res.status(503).json({ success: false, message: "Media storage is not configured" });
  const safeName = parsed.data.filename.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "upload";
  const key = `uploads/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeName}`;
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const now = new Date(); const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); const date = amzDate.slice(0, 8); const region = "auto"; const service = "s3"; const expires = 900;
  const credential = `${accessKey}/${date}/${region}/${service}/aws4_request`;
  const params: Record<string,string> = { "X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Credential": credential, "X-Amz-Date": amzDate, "X-Amz-Expires": String(expires), "X-Amz-SignedHeaders": "host" };
  const query = Object.keys(params).sort().map(k => `${enc(k)}=${enc(params[k]!)}`).join("&");
  const uri = `/${enc(bucket)}/${key.split("/").map(enc).join("/")}`;
  const canonical = `PUT\n${uri}\n${query}\nhost:${host}\n\nhost\nUNSIGNED-PAYLOAD`;
  const scope = `${date}/${region}/${service}/aws4_request`; const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`;
  const kDate = hmac(`AWS4${secretKey}`, date), kRegion = hmac(kDate, region), kService = hmac(kRegion, service), kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(toSign).digest("hex");
  const uploadUrl = `https://${host}${uri}?${query}&X-Amz-Signature=${signature}`;
  const publicBase = process.env.R2_PUBLIC_BASE_URL?.replace(/\/$/, "");
  return res.status(201).json({ success: true, data: { key, uploadUrl, method: "PUT", expiresIn: expires, contentType: parsed.data.contentType, maxSize: 25 * 1024 * 1024, publicUrl: publicBase ? `${publicBase}/${key.split("/").map(enc).join("/")}` : null } });
});

export default router;
