import { Router } from "express";
import prisma from "../../lib/prisma.js";
import { requireAuth, type AuthenticatedRequest } from "../../middlewares/auth.middleware.js";

const router = Router();

const getParam = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

router.get("/modules/:id/chapters", async (req, res) => {
  const moduleId = getParam(req.params.id);
  if (!moduleId) return res.status(400).json({ success: false, message: "Module ID is required" });

  const module = await prisma.module.findFirst({
    where: { id: moduleId, isPublished: true, course: { isPublished: true, program: { isPublished: true } } },
    select: { id: true },
  });
  if (!module) return res.status(404).json({ success: false, message: "Module not found" });

  const chapters = await prisma.chapter.findMany({
    where: { moduleId: module.id, isPublished: true },
    orderBy: { position: "asc" },
    select: { id: true, moduleId: true, title: true, slug: true, description: true, position: true, isPublished: true, createdAt: true, updatedAt: true },
  });
  return res.json({ success: true, data: { chapters } });
});

router.get("/modules/:id", async (req, res) => {
  const moduleId = getParam(req.params.id);
  if (!moduleId) return res.status(400).json({ success: false, message: "Module ID is required" });

  const module = await prisma.module.findFirst({
    where: { id: moduleId, isPublished: true, course: { isPublished: true, program: { isPublished: true } } },
    include: { course: { select: { id: true, title: true, slug: true, programId: true } } },
  });
  if (!module) return res.status(404).json({ success: false, message: "Module not found" });
  return res.json({ success: true, data: { module } });
});

router.get("/chapters/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  const chapterId = getParam(req.params.id);
  if (!chapterId) return res.status(400).json({ success: false, message: "Chapter ID is required" });

  const chapter = await prisma.chapter.findFirst({
    where: { id: chapterId, isPublished: true, module: { isPublished: true, course: { isPublished: true, program: { isPublished: true } } } },
    include: {
      module: {
        select: {
          id: true,
          title: true,
          slug: true,
          courseId: true,
          course: { select: { programId: true } },
        },
      },
    },
  });
  if (!chapter) return res.status(404).json({ success: false, message: "Chapter not found" });

  const programId = chapter.module.course.programId;
  const enrollment = await prisma.enrollment.findUnique({ where: { userId_programId: { userId: req.userId!, programId } } });
  if (!enrollment || enrollment.status !== "ACTIVE") return res.status(403).json({ success: false, message: "Active program enrollment required" });

  return res.json({ success: true, data: { chapter } });
});

export default router;
