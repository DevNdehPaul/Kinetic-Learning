import { Router } from "express";
import { Prisma } from "../../generated/prisma/client.js";
import prisma from "../../lib/prisma.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireAdmin } from "../../middlewares/admin.middleware.js";
import { issueCertificateIfEligible } from "../learning/graduation.routes.js";
import {
  chapterCreateSchema, chapterUpdateSchema, courseCreateSchema, courseUpdateSchema,
  moduleCreateSchema, moduleUpdateSchema, programCreateSchema, programUpdateSchema,
} from "./admin.schema.js";

const router = Router();
router.use(requireAuth, requireAdmin);

const validationError = (res: any, error: any) => res.status(400).json({ success: false, message: "Validation failed", errors: error.flatten().fieldErrors });
const handleError = (res: any, error: unknown) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return res.status(409).json({ success: false, message: "A record with this slug already exists in this scope" });
    if (error.code === "P2003") return res.status(400).json({ success: false, message: "Referenced parent record does not exist" });
    if (error.code === "P2025") return res.status(404).json({ success: false, message: "Record not found" });
  }
  console.error("Admin content error:", error);
  return res.status(500).json({ success: false, message: "Unable to process request" });
};

router.post("/programs", async (req, res) => { const v = programCreateSchema.safeParse(req.body); if (!v.success) return validationError(res, v.error); try { const program = await prisma.program.create({ data: v.data }); return res.status(201).json({ success: true, data: { program } }); } catch (e) { return handleError(res, e); } });
router.patch("/programs/:id", async (req, res) => { const v = programUpdateSchema.safeParse(req.body); if (!v.success) return validationError(res, v.error); try { const program = await prisma.program.update({ where: { id: req.params.id }, data: v.data }); return res.json({ success: true, data: { program } }); } catch (e) { return handleError(res, e); } });
router.delete("/programs/:id", async (req, res) => { try { await prisma.program.delete({ where: { id: req.params.id } }); return res.json({ success: true, message: "Program deleted" }); } catch (e) { return handleError(res, e); } });

router.post("/courses", async (req, res) => { const v = courseCreateSchema.safeParse(req.body); if (!v.success) return validationError(res, v.error); try { const course = await prisma.course.create({ data: v.data }); return res.status(201).json({ success: true, data: { course } }); } catch (e) { return handleError(res, e); } });
router.patch("/courses/:id", async (req, res) => { const v = courseUpdateSchema.safeParse(req.body); if (!v.success) return validationError(res, v.error); try { const course = await prisma.course.update({ where: { id: req.params.id }, data: v.data }); return res.json({ success: true, data: { course } }); } catch (e) { return handleError(res, e); } });
router.delete("/courses/:id", async (req, res) => { try { await prisma.course.delete({ where: { id: req.params.id } }); return res.json({ success: true, message: "Course deleted" }); } catch (e) { return handleError(res, e); } });

router.post("/modules", async (req, res) => { const v = moduleCreateSchema.safeParse(req.body); if (!v.success) return validationError(res, v.error); try { const module = await prisma.module.create({ data: v.data }); return res.status(201).json({ success: true, data: { module } }); } catch (e) { return handleError(res, e); } });
router.patch("/modules/:id", async (req, res) => { const v = moduleUpdateSchema.safeParse(req.body); if (!v.success) return validationError(res, v.error); try { const module = await prisma.module.update({ where: { id: req.params.id }, data: v.data }); return res.json({ success: true, data: { module } }); } catch (e) { return handleError(res, e); } });
router.delete("/modules/:id", async (req, res) => { try { await prisma.module.delete({ where: { id: req.params.id } }); return res.json({ success: true, message: "Module deleted" }); } catch (e) { return handleError(res, e); } });

router.post("/chapters", async (req, res) => { const v = chapterCreateSchema.safeParse(req.body); if (!v.success) return validationError(res, v.error); try { const chapter = await prisma.chapter.create({ data: v.data }); return res.status(201).json({ success: true, data: { chapter } }); } catch (e) { return handleError(res, e); } });
router.patch("/chapters/:id", async (req, res) => { const v = chapterUpdateSchema.safeParse(req.body); if (!v.success) return validationError(res, v.error); try { const chapter = await prisma.chapter.update({ where: { id: req.params.id }, data: v.data }); return res.json({ success: true, data: { chapter } }); } catch (e) { return handleError(res, e); } });
router.delete("/chapters/:id", async (req, res) => { try { await prisma.chapter.delete({ where: { id: req.params.id } }); return res.json({ success: true, message: "Chapter deleted" }); } catch (e) { return handleError(res, e); } });


router.get("/enrollments", async (_req, res) => {
  try {
    const enrollments = await prisma.enrollment.findMany({ orderBy: { enrolledAt: "desc" }, include: { user: { select: { id: true, firstName: true, lastName: true, email: true } }, program: { select: { id: true, title: true, slug: true } }, revokedBy: { select: { id: true, firstName: true, lastName: true } } } });
    return res.json({ success: true, data: { enrollments } });
  } catch (e) { return handleError(res, e); }
});

router.patch("/enrollments/:id/revoke", async (req: any, res) => {
  try {
    const enrollment = await prisma.enrollment.update({ where: { id: req.params.id }, data: { status: "REVOKED", revokedAt: new Date(), revokedById: req.userId, revocationReason: typeof req.body?.reason === "string" ? req.body.reason.trim() || null : null } });
    return res.json({ success: true, message: "Enrollment revoked", data: { enrollment } });
  } catch (e) { return handleError(res, e); }
});

router.patch("/enrollments/:id/reactivate", async (req, res) => {
  try {
    const target = await prisma.enrollment.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ success: false, message: "Enrollment not found" });
    const active = await prisma.enrollment.findFirst({ where: { userId: target.userId, status: "ACTIVE", id: { not: target.id } }, include: { program: { select: { id: true, title: true } } } });
    if (active) return res.status(409).json({ success: false, message: "User already has another active program", data: { activeProgram: active.program } });
    const enrollment = await prisma.enrollment.update({ where: { id: target.id }, data: { status: "ACTIVE", revokedAt: null, revokedById: null, revocationReason: null, completedAt: null } });
    return res.json({ success: true, message: "Enrollment reactivated", data: { enrollment } });
  } catch (e) { return handleError(res, e); }
});

router.get("/questions", async (_req, res) => {
  try {
    const questions = await prisma.question.findMany({ orderBy: [{ type: "asc" }, { position: "asc" }], include: { options: { orderBy: { position: "asc" } } } });
    return res.json({ success: true, data: { questions } });
  } catch (e) { return handleError(res, e); }
});

router.post("/questions", async (req, res) => {
  try {
    const { type, prompt, explanation, points = 1, position = 0, isPublished = false, programId = null, moduleId = null, chapterId = null, options } = req.body ?? {};
    if (!["PLACEMENT", "CHAPTER", "MODULE_TEST", "FINAL_TEST"].includes(type) || typeof prompt !== "string" || !prompt.trim() || !Array.isArray(options) || options.length < 2) return res.status(400).json({ success: false, message: "A valid type, prompt and at least two options are required" });
    if (options.filter((o: any) => o?.isCorrect === true).length !== 1) return res.status(400).json({ success: false, message: "Exactly one option must be correct" });
    const scopeValid = (type === "PLACEMENT" && programId && !moduleId && !chapterId) || (type === "FINAL_TEST" && programId && !moduleId && !chapterId) || (type === "MODULE_TEST" && moduleId && !programId && !chapterId) || (type === "CHAPTER" && chapterId && !programId && !moduleId);
    if (!scopeValid) return res.status(400).json({ success: false, message: "Question scope does not match its type" });
    const question = await prisma.question.create({ data: { type, prompt: prompt.trim(), explanation: typeof explanation === "string" ? explanation.trim() || null : null, points, position, isPublished, programId, moduleId, chapterId, options: { create: options.map((o: any, i: number) => ({ text: String(o.text ?? "").trim(), isCorrect: o.isCorrect === true, position: Number.isInteger(o.position) ? o.position : i })) } }, include: { options: { orderBy: { position: "asc" } } } });
    return res.status(201).json({ success: true, data: { question } });
  } catch (e) { return handleError(res, e); }
});

router.patch("/questions/:id", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) return res.status(400).json({ success: false, message: "Question ID is required" });
    const { prompt, explanation, points, position, isPublished } = req.body ?? {};
    const question = await prisma.question.update({ where: { id }, data: { ...(typeof prompt === "string" ? { prompt: prompt.trim() } : {}), ...(explanation !== undefined ? { explanation: typeof explanation === "string" ? explanation.trim() || null : null } : {}), ...(Number.isInteger(points) ? { points } : {}), ...(Number.isInteger(position) ? { position } : {}), ...(typeof isPublished === "boolean" ? { isPublished } : {}) } });
    return res.json({ success: true, data: { question } });
  } catch (e) { return handleError(res, e); }
});

router.delete("/questions/:id", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) return res.status(400).json({ success: false, message: "Question ID is required" });
    await prisma.question.delete({ where: { id } });
    return res.json({ success: true, message: "Question deleted" });
  } catch (e) { return handleError(res, e); }
});


router.get("/submissions", async (_req, res) => {
  try {
    const submissions = await prisma.projectSubmission.findMany({ orderBy: { submittedAt: "desc" }, include: { user: { select: { id: true, firstName: true, lastName: true, email: true } }, program: { select: { id: true, title: true, slug: true } }, reviewedBy: { select: { id: true, firstName: true, lastName: true } } } });
    return res.json({ success: true, data: { submissions } });
  } catch (e) { return handleError(res, e); }
});

router.patch("/submissions/:id", async (req: any, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { status, feedback } = req.body ?? {};
    if (!id) return res.status(400).json({ success: false, message: "Submission ID is required" });
    if (!["APPROVED", "REVISION_REQUIRED", "REJECTED"].includes(status)) return res.status(400).json({ success: false, message: "Status must be APPROVED, REVISION_REQUIRED or REJECTED" });
    const submission = await prisma.projectSubmission.update({ where: { id }, data: { status, feedback: typeof feedback === "string" ? feedback.trim() || null : null, reviewedAt: new Date(), reviewedById: req.userId } });
    const certificate = status === "APPROVED" ? await issueCertificateIfEligible(submission.userId, submission.programId, req.userId) : null;
    return res.json({ success: true, message: "Submission reviewed", data: { submission, certificate, certificateIssued: Boolean(certificate) } });
  } catch (e) { return handleError(res, e); }
});

export default router;
