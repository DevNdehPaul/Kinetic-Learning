import { Router } from "express";
import prisma from "../../lib/prisma.js";

const router = Router();

router.get("/:id/modules", async (req, res) => {
  const course = await prisma.course.findFirst({
    where: { id: req.params.id, isPublished: true, program: { isPublished: true } }, select: { id: true },
  });
  if (!course) return res.status(404).json({ success: false, message: "Course not found" });
  const modules = await prisma.module.findMany({ where: { courseId: course.id, isPublished: true }, orderBy: { position: "asc" } });
  return res.json({ success: true, data: { modules } });
});

router.get("/:id", async (req, res) => {
  const course = await prisma.course.findFirst({
    where: { id: req.params.id, isPublished: true, program: { isPublished: true } },
    include: { program: { select: { id: true, title: true, slug: true } } },
  });
  if (!course) return res.status(404).json({ success: false, message: "Course not found" });
  return res.json({ success: true, data: { course } });
});

export default router;
