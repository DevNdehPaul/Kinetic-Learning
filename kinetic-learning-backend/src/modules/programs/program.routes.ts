import { Router } from "express";
import prisma from "../../lib/prisma.js";

const router = Router();

router.get("/", async (_req, res) => {
  const programs = await prisma.program.findMany({
    where: { isPublished: true },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, slug: true, description: true, imageUrl: true, createdAt: true },
  });
  res.json({ success: true, data: { programs } });
});

router.get("/:id/courses", async (req, res) => {
  const program = await prisma.program.findFirst({ where: { id: req.params.id, isPublished: true }, select: { id: true } });
  if (!program) return res.status(404).json({ success: false, message: "Program not found" });
  const courses = await prisma.course.findMany({ where: { programId: program.id, isPublished: true }, orderBy: { position: "asc" } });
  return res.json({ success: true, data: { courses } });
});

router.get("/:id", async (req, res) => {
  const program = await prisma.program.findFirst({
    where: { id: req.params.id, isPublished: true },
    select: { id: true, title: true, slug: true, description: true, imageUrl: true, createdAt: true, updatedAt: true },
  });
  if (!program) return res.status(404).json({ success: false, message: "Program not found" });
  return res.json({ success: true, data: { program } });
});

export default router;
