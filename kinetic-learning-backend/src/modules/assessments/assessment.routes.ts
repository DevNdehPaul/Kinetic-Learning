import { Router } from "express";
import { z } from "zod";
import prisma from "../../lib/prisma.js";
import { requireAuth, type AuthenticatedRequest } from "../../middlewares/auth.middleware.js";

const router = Router();
router.use(requireAuth);
const param = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : v;
const submitSchema = z.object({ answers: z.array(z.object({ questionId: z.string().uuid(), optionId: z.string().uuid() })).min(1) });

async function hasActiveEnrollment(userId: string, programId: string) {
  return prisma.enrollment.findFirst({ where: { userId, programId, status: "ACTIVE" }, select: { id: true } });
}

async function createAttempt(userId: string, type: "PLACEMENT"|"MODULE_TEST"|"FINAL_TEST", ids: { programId?: string; moduleId?: string }) {
  return prisma.assessmentAttempt.create({ data: { userId, type, ...ids } });
}

async function submitAttempt(attemptId: string, userId: string, body: unknown) {
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) return { error: { status: 400, body: { success: false, message: "Validation failed", errors: parsed.error.flatten().fieldErrors } } };
  const attempt = await prisma.assessmentAttempt.findFirst({ where: { id: attemptId, userId }, select: { id: true, type: true, programId: true, moduleId: true, chapterId: true, submittedAt: true } });
  if (!attempt) return { error: { status: 404, body: { success: false, message: "Attempt not found" } } };
  if (attempt.submittedAt) return { error: { status: 409, body: { success: false, message: "Attempt already submitted" } } };

  const questionWhere: any = { isPublished: true, type: attempt.type };
  if (attempt.programId) questionWhere.programId = attempt.programId;
  if (attempt.moduleId) questionWhere.moduleId = attempt.moduleId;
  if (attempt.chapterId) questionWhere.chapterId = attempt.chapterId;
  const questions = await prisma.question.findMany({ where: questionWhere, include: { options: true } });
  if (!questions.length) return { error: { status: 409, body: { success: false, message: "No published questions are configured for this assessment" } } };

  const answerMap = new Map(parsed.data.answers.map(a => [a.questionId, a.optionId]));
  if (answerMap.size !== questions.length || questions.some(q => !answerMap.has(q.id))) return { error: { status: 400, body: { success: false, message: "Answer every question exactly once" } } };

  let score = 0; const maxScore = questions.reduce((sum, q) => sum + q.points, 0);
  const rows = questions.map(q => {
    const optionId = answerMap.get(q.id)!;
    const option = q.options.find(o => o.id === optionId);
    if (!option) throw new Error("INVALID_OPTION");
    const pointsAwarded = option.isCorrect ? q.points : 0; score += pointsAwarded;
    return { attemptId: attempt.id, questionId: q.id, optionId, isCorrect: option.isCorrect, pointsAwarded };
  });
  const percentage = maxScore === 0 ? 0 : Math.round((score / maxScore) * 100);
  const passed = percentage >= 70;
  await prisma.$transaction([
    prisma.attemptAnswer.createMany({ data: rows }),
    prisma.assessmentAttempt.update({ where: { id: attempt.id }, data: { score, maxScore, percentage, passed, submittedAt: new Date() } }),
  ]);
  return { result: { attemptId: attempt.id, score, maxScore, percentage, passed } };
}

router.post("/programs/:id/placement", async (req: AuthenticatedRequest, res) => {
  const programId = param(req.params.id); if (!programId) return res.status(400).json({ success: false, message: "Program ID is required" });
  const program = await prisma.program.findFirst({ where: { id: programId, isPublished: true }, select: { id: true } });
  if (!program) return res.status(404).json({ success: false, message: "Program not found" });
  const attempt = await createAttempt(req.userId!, "PLACEMENT", { programId });
  return res.status(201).json({ success: true, data: { attempt } });
});

router.post("/placement/:attemptId/submit", async (req: AuthenticatedRequest, res) => {
  const id = param(req.params.attemptId); if (!id) return res.status(400).json({ success: false, message: "Attempt ID is required" });
  try { const out = await submitAttempt(id, req.userId!, req.body); if (out.error) return res.status(out.error.status).json(out.error.body); return res.json({ success: true, message: "Placement submitted", data: out.result }); }
  catch (e) { if (e instanceof Error && e.message === "INVALID_OPTION") return res.status(400).json({ success: false, message: "An option does not belong to its question" }); throw e; }
});

router.get("/placement/:attemptId/result", async (req: AuthenticatedRequest, res) => {
  const id = param(req.params.attemptId); if (!id) return res.status(400).json({ success: false, message: "Attempt ID is required" });
  const attempt = await prisma.assessmentAttempt.findFirst({ where: { id, userId: req.userId!, type: "PLACEMENT" }, select: { id: true, programId: true, score: true, maxScore: true, percentage: true, passed: true, submittedAt: true } });
  if (!attempt) return res.status(404).json({ success: false, message: "Placement attempt not found" });
  return res.json({ success: true, data: { result: attempt } });
});

router.get("/programs/:id/learning-path", async (req: AuthenticatedRequest, res) => {
  const programId = param(req.params.id); if (!programId) return res.status(400).json({ success: false, message: "Program ID is required" });
  if (!await hasActiveEnrollment(req.userId!, programId)) return res.status(403).json({ success: false, message: "Active program enrollment required" });
  const placement = await prisma.assessmentAttempt.findFirst({ where: { userId: req.userId!, programId, type: "PLACEMENT", submittedAt: { not: null } }, orderBy: { submittedAt: "desc" }, select: { percentage: true } });
  const courses = await prisma.course.findMany({ where: { programId, isPublished: true }, orderBy: { position: "asc" }, include: { modules: { where: { isPublished: true }, orderBy: { position: "asc" }, select: { id: true, title: true, slug: true, position: true } } } });
  const recommendation = placement ? (placement.percentage! >= 80 ? "ADVANCED_START" : placement.percentage! >= 50 ? "INTERMEDIATE_START" : "FOUNDATION_START") : "TAKE_PLACEMENT";
  return res.json({ success: true, data: { programId, placementPercentage: placement?.percentage ?? null, recommendation, courses } });
});

router.get("/chapters/:id/questions", async (req: AuthenticatedRequest, res) => {
  const chapterId = param(req.params.id); if (!chapterId) return res.status(400).json({ success: false, message: "Chapter ID is required" });
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId }, select: { module: { select: { course: { select: { programId: true } } } } } });
  if (!chapter) return res.status(404).json({ success: false, message: "Chapter not found" });
  if (!await hasActiveEnrollment(req.userId!, chapter.module.course.programId)) return res.status(403).json({ success: false, message: "Active program enrollment required" });
  const questions = await prisma.question.findMany({ where: { chapterId, type: "CHAPTER", isPublished: true }, orderBy: { position: "asc" }, select: { id: true, prompt: true, points: true, position: true, options: { orderBy: { position: "asc" }, select: { id: true, text: true, position: true } } } });
  return res.json({ success: true, data: { questions } });
});

router.post("/chapters/:id/questions/submit", async (req: AuthenticatedRequest, res) => {
  const chapterId = param(req.params.id); if (!chapterId) return res.status(400).json({ success: false, message: "Chapter ID is required" });
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId }, select: { module: { select: { course: { select: { programId: true } } } } } });
  if (!chapter || !await hasActiveEnrollment(req.userId!, chapter.module.course.programId)) return res.status(403).json({ success: false, message: "Active program enrollment required" });
  const attempt = await prisma.assessmentAttempt.create({ data: { userId: req.userId!, type: "CHAPTER", chapterId } });
  try { const out = await submitAttempt(attempt.id, req.userId!, req.body); if (out.error) { await prisma.assessmentAttempt.delete({ where: { id: attempt.id } }); return res.status(out.error.status).json(out.error.body); } return res.json({ success: true, message: "Chapter questions submitted", data: out.result }); }
  catch (e) { await prisma.assessmentAttempt.delete({ where: { id: attempt.id } }).catch(() => undefined); if (e instanceof Error && e.message === "INVALID_OPTION") return res.status(400).json({ success: false, message: "An option does not belong to its question" }); throw e; }
});

router.post("/modules/:id/test", async (req: AuthenticatedRequest, res) => {
  const moduleId = param(req.params.id); if (!moduleId) return res.status(400).json({ success: false, message: "Module ID is required" });
  const module = await prisma.module.findUnique({ where: { id: moduleId }, select: { course: { select: { programId: true } } } });
  if (!module) return res.status(404).json({ success: false, message: "Module not found" });
  if (!await hasActiveEnrollment(req.userId!, module.course.programId)) return res.status(403).json({ success: false, message: "Active program enrollment required" });
  const attempt = await createAttempt(req.userId!, "MODULE_TEST", { moduleId });
  return res.status(201).json({ success: true, data: { attempt } });
});

router.post("/modules/:id/retest", async (req: AuthenticatedRequest, res) => {
  const moduleId = param(req.params.id); if (!moduleId) return res.status(400).json({ success: false, message: "Module ID is required" });
  const previous = await prisma.assessmentAttempt.findFirst({ where: { userId: req.userId!, moduleId, type: "MODULE_TEST", submittedAt: { not: null } } });
  if (!previous) return res.status(409).json({ success: false, message: "Complete an initial module test before requesting a retest" });
  const module = await prisma.module.findUnique({ where: { id: moduleId }, select: { course: { select: { programId: true } } } });
  if (!module || !await hasActiveEnrollment(req.userId!, module.course.programId)) return res.status(403).json({ success: false, message: "Active program enrollment required" });
  const attempt = await createAttempt(req.userId!, "MODULE_TEST", { moduleId });
  return res.status(201).json({ success: true, data: { attempt } });
});

router.post("/programs/:id/final-test", async (req: AuthenticatedRequest, res) => {
  const programId = param(req.params.id); if (!programId) return res.status(400).json({ success: false, message: "Program ID is required" });
  if (!await hasActiveEnrollment(req.userId!, programId)) return res.status(403).json({ success: false, message: "Active program enrollment required" });
  const attempt = await createAttempt(req.userId!, "FINAL_TEST", { programId });
  return res.status(201).json({ success: true, data: { attempt } });
});

router.post("/tests/:attemptId/submit", async (req: AuthenticatedRequest, res) => {
  const id = param(req.params.attemptId); if (!id) return res.status(400).json({ success: false, message: "Attempt ID is required" });
  const target = await prisma.assessmentAttempt.findFirst({ where: { id, userId: req.userId!, type: { in: ["MODULE_TEST", "FINAL_TEST"] } }, select: { id: true } });
  if (!target) return res.status(404).json({ success: false, message: "Test attempt not found" });
  try { const out = await submitAttempt(id, req.userId!, req.body); if (out.error) return res.status(out.error.status).json(out.error.body); return res.json({ success: true, message: "Test submitted", data: out.result }); }
  catch (e) { if (e instanceof Error && e.message === "INVALID_OPTION") return res.status(400).json({ success: false, message: "An option does not belong to its question" }); throw e; }
});

router.get("/tests/:attemptId/result", async (req: AuthenticatedRequest, res) => {
  const id = param(req.params.attemptId); if (!id) return res.status(400).json({ success: false, message: "Attempt ID is required" });
  const attempt = await prisma.assessmentAttempt.findFirst({ where: { id, userId: req.userId!, type: { in: ["MODULE_TEST", "FINAL_TEST"] } }, select: { id: true, type: true, programId: true, moduleId: true, score: true, maxScore: true, percentage: true, passed: true, submittedAt: true } });
  if (!attempt) return res.status(404).json({ success: false, message: "Test attempt not found" });
  return res.json({ success: true, data: { result: attempt } });
});

export default router;
