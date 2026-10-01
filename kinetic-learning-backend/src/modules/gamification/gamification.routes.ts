import { Router } from "express";
import prisma from "../../lib/prisma.js";
import { requireAuth, type AuthenticatedRequest } from "../../middlewares/auth.middleware.js";
import { getBadges, getStreak, syncGamification, xpLevel } from "./gamification.service.js";

const router = Router();
router.use(requireAuth);

router.get("/me/xp", async (req: AuthenticatedRequest, res) => {
  const totalXp = await syncGamification(req.userId!);
  const recent = await prisma.xpEvent.findMany({ where: { userId: req.userId! }, orderBy: { earnedAt: "desc" }, take: 10, select: { id: true, type: true, points: true, earnedAt: true } });
  return res.json({ success: true, data: { ...xpLevel(totalXp), recent } });
});

router.get("/me/streak", async (req: AuthenticatedRequest, res) => {
  await syncGamification(req.userId!);
  return res.json({ success: true, data: { streak: await getStreak(req.userId!) } });
});

router.get("/me/badges", async (req: AuthenticatedRequest, res) => {
  await syncGamification(req.userId!);
  return res.json({ success: true, data: { badges: await getBadges(req.userId!) } });
});

router.get("/me/dashboard", async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const totalXp = await syncGamification(userId);
  const [user, activeEnrollment, enrollments, certificates, badges, streak] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, firstName: true, lastName: true, email: true } }),
    prisma.enrollment.findFirst({ where: { userId, status: "ACTIVE" }, include: { program: { select: { id: true, title: true, slug: true, imageUrl: true } } } }),
    prisma.enrollment.count({ where: { userId } }),
    prisma.certificate.count({ where: { userId } }),
    getBadges(userId),
    getStreak(userId),
  ]);

  let progress = null;
  if (activeEnrollment) {
    const totalChapters = await prisma.chapter.count({ where: { isPublished: true, module: { isPublished: true, course: { isPublished: true, programId: activeEnrollment.programId } } } });
    const completedChapters = await prisma.chapterProgress.count({ where: { userId, chapter: { isPublished: true, module: { isPublished: true, course: { isPublished: true, programId: activeEnrollment.programId } } } } });
    progress = { programId: activeEnrollment.programId, totalChapters, completedChapters, percentage: totalChapters ? Math.round(completedChapters / totalChapters * 100) : 0 };
  }

  return res.json({ success: true, data: { user, activeEnrollment, progress, xp: xpLevel(totalXp), streak, badges, totals: { enrollments, certificates } } });
});

router.get("/leaderboard", async (req: AuthenticatedRequest, res) => {
  await syncGamification(req.userId!);
  const grouped = await prisma.xpEvent.groupBy({ by: ["userId"], _sum: { points: true }, orderBy: { _sum: { points: "desc" } }, take: 50 });
  const users = await prisma.user.findMany({ where: { id: { in: grouped.map(g => g.userId) }, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true } });
  const map = new Map(users.map(u => [u.id, u]));
  const leaderboard = grouped.filter(g => map.has(g.userId)).map((g, i) => ({ rank: i + 1, user: map.get(g.userId), xp: g._sum.points ?? 0 }));
  const me = leaderboard.find(row => row.user?.id === req.userId!) ?? null;
  return res.json({ success: true, data: { leaderboard, me } });
});

export default router;
