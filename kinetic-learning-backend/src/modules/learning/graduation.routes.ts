import { randomBytes } from "node:crypto";
import { Router } from "express";
import prisma from "../../lib/prisma.js";
import { requireAuth, type AuthenticatedRequest } from "../../middlewares/auth.middleware.js";

const router = Router();
const param = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : v;

async function activeEnrollment(userId: string, programId: string) {
  return prisma.enrollment.findFirst({ where: { userId, programId, status: "ACTIVE" }, select: { id: true } });
}

router.post("/programs/:id/project/submit", requireAuth, async (req: AuthenticatedRequest, res) => {
  const programId = param(req.params.id);
  if (!programId) return res.status(400).json({ success: false, message: "Program ID is required" });
  if (!await activeEnrollment(req.userId!, programId)) return res.status(403).json({ success: false, message: "Active program enrollment required" });
  const { title, description, projectUrl, repositoryUrl } = req.body ?? {};
  if (typeof title !== "string" || !title.trim() || typeof projectUrl !== "string" || !projectUrl.trim()) return res.status(400).json({ success: false, message: "Project title and projectUrl are required" });
  try { new URL(projectUrl); if (repositoryUrl) new URL(repositoryUrl); } catch { return res.status(400).json({ success: false, message: "Project URLs must be valid URLs" }); }
  const existing = await prisma.projectSubmission.findUnique({ where: { userId_programId: { userId: req.userId!, programId } } });
  if (existing?.status === "APPROVED") return res.status(409).json({ success: false, message: "Approved project cannot be resubmitted" });
  if (existing?.status === "PENDING_REVIEW") return res.status(409).json({ success: false, message: "Project is already pending review" });
  const data = { title: title.trim(), description: typeof description === "string" ? description.trim() || null : null, projectUrl: projectUrl.trim(), repositoryUrl: typeof repositoryUrl === "string" ? repositoryUrl.trim() || null : null, status: "PENDING_REVIEW" as const, feedback: null, reviewedAt: null, reviewedById: null, submittedAt: new Date() };
  const submission = existing
    ? await prisma.projectSubmission.update({ where: { id: existing.id }, data })
    : await prisma.projectSubmission.create({ data: { userId: req.userId!, programId, ...data } });
  return res.status(existing ? 200 : 201).json({ success: true, message: existing ? "Project resubmitted" : "Project submitted", data: { submission } });
});

router.get("/programs/:id/project/status", requireAuth, async (req: AuthenticatedRequest, res) => {
  const programId = param(req.params.id);
  if (!programId) return res.status(400).json({ success: false, message: "Program ID is required" });
  const submission = await prisma.projectSubmission.findUnique({ where: { userId_programId: { userId: req.userId!, programId } }, select: { id: true, programId: true, title: true, description: true, projectUrl: true, repositoryUrl: true, status: true, feedback: true, submittedAt: true, reviewedAt: true, updatedAt: true } });
  return res.json({ success: true, data: { submission } });
});

router.get("/me/certificates", requireAuth, async (req: AuthenticatedRequest, res) => {
  const certificates = await prisma.certificate.findMany({ where: { userId: req.userId! }, orderBy: { issuedAt: "desc" }, include: { program: { select: { id: true, title: true, slug: true } } } });
  return res.json({ success: true, data: { certificates } });
});

router.get("/certificates/verify/:code", async (req, res) => {
  const code = param(req.params.code);
  if (!code) return res.status(400).json({ success: false, message: "Verification code is required" });
  const certificate = await prisma.certificate.findUnique({ where: { verificationCode: code }, select: { id: true, verificationCode: true, issuedAt: true, user: { select: { firstName: true, lastName: true } }, program: { select: { id: true, title: true, slug: true } } } });
  if (!certificate) return res.status(404).json({ success: false, message: "Certificate not found" });
  return res.json({ success: true, valid: true, data: { certificate } });
});

router.get("/certificates/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  const id = param(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Certificate ID is required" });
  const certificate = await prisma.certificate.findUnique({ where: { id }, include: { user: { select: { id: true, firstName: true, lastName: true, email: true, role: true } }, program: { select: { id: true, title: true, slug: true } } } });
  if (!certificate) return res.status(404).json({ success: false, message: "Certificate not found" });
  const requester = await prisma.user.findUnique({ where: { id: req.userId! }, select: { role: true } });
  if (certificate.userId !== req.userId && requester?.role !== "ADMIN") return res.status(403).json({ success: false, message: "Access denied" });
  return res.json({ success: true, data: { certificate } });
});

export async function issueCertificateIfEligible(userId: string, programId: string, issuedById?: string) {
  const [publishedChapters, completedChapters, finalTest, project] = await Promise.all([
    prisma.chapter.count({ where: { isPublished: true, module: { isPublished: true, course: { isPublished: true, programId } } } }),
    prisma.chapterProgress.count({ where: { userId, chapter: { isPublished: true, module: { isPublished: true, course: { isPublished: true, programId } } } } }),
    prisma.assessmentAttempt.findFirst({ where: { userId, programId, type: "FINAL_TEST", submittedAt: { not: null }, passed: true }, orderBy: { submittedAt: "desc" }, select: { id: true } }),
    prisma.projectSubmission.findUnique({ where: { userId_programId: { userId, programId } }, select: { status: true } }),
  ]);
  if (publishedChapters === 0 || completedChapters < publishedChapters || !finalTest || project?.status !== "APPROVED") return null;
  const existing = await prisma.certificate.findUnique({ where: { userId_programId: { userId, programId } } });
  if (existing) return existing;
  const verificationCode = `KL-${randomBytes(8).toString("hex").toUpperCase()}`;
  const certificate = await prisma.certificate.create({ data: { userId, programId, verificationCode, issuedById: issuedById ?? null } });
  await prisma.enrollment.updateMany({ where: { userId, programId, status: "ACTIVE" }, data: { status: "COMPLETED", completedAt: new Date() } });
  return certificate;
}

export default router;
