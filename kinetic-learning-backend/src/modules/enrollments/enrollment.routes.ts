import { Router } from "express";
import prisma from "../../lib/prisma.js";
import { requireAuth, type AuthenticatedRequest } from "../../middlewares/auth.middleware.js";

const router = Router();
router.use(requireAuth);

const getParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

router.post("/programs/:id/enroll", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const programId = getParam(req.params.id);
    if (!programId) return res.status(400).json({ success: false, message: "Program ID is required" });

    const program = await prisma.program.findFirst({ where: { id: programId, isPublished: true }, select: { id: true, title: true } });
    if (!program) return res.status(404).json({ success: false, message: "Program not found" });

    const active = await prisma.enrollment.findFirst({ where: { userId, status: "ACTIVE" }, include: { program: { select: { id: true, title: true } } } });
    if (active && active.programId !== program.id) return res.status(409).json({ success: false, message: "You already have an active program", data: { activeProgram: active.program } });
    if (active) return res.status(409).json({ success: false, message: "You are already enrolled in this program" });

    const existing = await prisma.enrollment.findUnique({ where: { userId_programId: { userId, programId: program.id } } });
    if (existing?.status === "REVOKED") return res.status(403).json({ success: false, message: "This enrollment was revoked. An administrator must reactivate it." });
    if (existing?.status === "COMPLETED") return res.status(409).json({ success: false, message: "You have already completed this program" });

    const newEnrollment = await prisma.enrollment.create({ data: { userId, programId: program.id }, include: { program: true } });
    return res.status(201).json({ success: true, message: "Enrollment successful", data: { enrollment: newEnrollment } });
  } catch (error) {
    console.error("Enrollment error:", error);
    return res.status(500).json({ success: false, message: "Unable to enroll" });
  }
});

router.get("/me/enrollments", async (req: AuthenticatedRequest, res) => {
  const enrollments = await prisma.enrollment.findMany({ where: { userId: req.userId! }, orderBy: { enrolledAt: "desc" }, include: { program: { select: { id: true, title: true, slug: true, imageUrl: true } } } });
  return res.json({ success: true, data: { enrollments } });
});

router.get("/me/enrollments/active", async (req: AuthenticatedRequest, res) => {
  const enrollment = await prisma.enrollment.findFirst({ where: { userId: req.userId!, status: "ACTIVE" }, include: { program: { select: { id: true, title: true, slug: true, imageUrl: true } } } });
  return res.json({ success: true, data: { enrollment } });
});

router.get("/me/progress/:programId", async (req: AuthenticatedRequest, res) => {
  const programId = getParam(req.params.programId);
  if (!programId) return res.status(400).json({ success: false, message: "Program ID is required" });

  const enrollment = await prisma.enrollment.findUnique({ where: { userId_programId: { userId: req.userId!, programId } } });
  if (!enrollment) return res.status(404).json({ success: false, message: "Enrollment not found" });

  const chapters = await prisma.chapter.findMany({ where: { isPublished: true, module: { isPublished: true, course: { programId, isPublished: true } } }, select: { id: true, moduleId: true } });
  const ids = chapters.map(c => c.id);
  const completed = ids.length ? await prisma.chapterProgress.findMany({ where: { userId: req.userId!, chapterId: { in: ids } }, select: { chapterId: true, completedAt: true } }) : [];
  const totalChapters = chapters.length;
  const completedChapters = completed.length;
  const percentage = totalChapters === 0 ? 0 : Math.round((completedChapters / totalChapters) * 100);

  return res.json({ success: true, data: { programId, enrollmentStatus: enrollment.status, totalChapters, completedChapters, percentage, completed } });
});

router.post("/chapters/:id/complete", async (req: AuthenticatedRequest, res) => {
  const chapterId = getParam(req.params.id);
  if (!chapterId) return res.status(400).json({ success: false, message: "Chapter ID is required" });

  const chapter = await prisma.chapter.findFirst({
    where: { id: chapterId, isPublished: true, module: { isPublished: true, course: { isPublished: true, program: { isPublished: true } } } },
    select: { id: true, module: { select: { course: { select: { programId: true } } } } },
  });
  if (!chapter) return res.status(404).json({ success: false, message: "Chapter not found" });

  const programId = chapter.module.course.programId;
  const enrollment = await prisma.enrollment.findUnique({ where: { userId_programId: { userId: req.userId!, programId } } });
  if (!enrollment || enrollment.status !== "ACTIVE") return res.status(403).json({ success: false, message: "Active program enrollment required" });

  const progress = await prisma.chapterProgress.upsert({ where: { userId_chapterId: { userId: req.userId!, chapterId: chapter.id } }, create: { userId: req.userId!, chapterId: chapter.id }, update: {} });
  return res.json({ success: true, message: "Chapter completed", data: { progress } });
});

export default router;
