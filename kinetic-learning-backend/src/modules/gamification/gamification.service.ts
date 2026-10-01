import prisma from "../../lib/prisma.js";

export const XP_RULES = {
  CHAPTER_COMPLETED: 20,
  CHAPTER_ASSESSMENT_PASSED: 15,
  MODULE_TEST_PASSED: 50,
  FINAL_TEST_PASSED: 100,
  PROJECT_APPROVED: 150,
  PROGRAM_COMPLETED: 250,
} as const;

const BADGES = [
  { key: "FIRST_CHAPTER", name: "First Step", description: "Complete your first chapter." },
  { key: "FIVE_CHAPTERS", name: "Momentum", description: "Complete 5 chapters." },
  { key: "FIRST_TEST_PASS", name: "Test Ready", description: "Pass your first module or final test." },
  { key: "PROJECT_APPROVED", name: "Project Builder", description: "Have a final project approved." },
  { key: "PROGRAM_COMPLETED", name: "Program Graduate", description: "Complete a learning program." },
  { key: "XP_500", name: "500 XP", description: "Earn at least 500 XP." },
] as const;

async function createXp(userId: string, sourceKey: string, type: string, points: number, earnedAt: Date) {
  await prisma.xpEvent.upsert({
    where: { sourceKey },
    create: { userId, sourceKey, type, points, earnedAt },
    update: {},
  });
}

export async function syncGamification(userId: string) {
  const [chapters, attempts, projects, certificates] = await Promise.all([
    prisma.chapterProgress.findMany({ where: { userId }, select: { id: true, completedAt: true } }),
    prisma.assessmentAttempt.findMany({
      where: { userId, submittedAt: { not: null }, passed: true, type: { in: ["CHAPTER", "MODULE_TEST", "FINAL_TEST"] } },
      select: { id: true, type: true, submittedAt: true },
    }),
    prisma.projectSubmission.findMany({ where: { userId, status: "APPROVED" }, select: { id: true, reviewedAt: true, updatedAt: true } }),
    prisma.certificate.findMany({ where: { userId }, select: { id: true, issuedAt: true } }),
  ]);

  for (const item of chapters) await createXp(userId, `chapter:${item.id}`, "CHAPTER_COMPLETED", XP_RULES.CHAPTER_COMPLETED, item.completedAt);
  for (const item of attempts) {
    const points = item.type === "CHAPTER" ? XP_RULES.CHAPTER_ASSESSMENT_PASSED : item.type === "MODULE_TEST" ? XP_RULES.MODULE_TEST_PASSED : XP_RULES.FINAL_TEST_PASSED;
    await createXp(userId, `attempt:${item.id}`, `${item.type}_PASSED`, points, item.submittedAt!);
  }
  for (const item of projects) await createXp(userId, `project:${item.id}`, "PROJECT_APPROVED", XP_RULES.PROJECT_APPROVED, item.reviewedAt ?? item.updatedAt);
  for (const item of certificates) await createXp(userId, `certificate:${item.id}`, "PROGRAM_COMPLETED", XP_RULES.PROGRAM_COMPLETED, item.issuedAt);

  const totalXp = (await prisma.xpEvent.aggregate({ where: { userId }, _sum: { points: true } }))._sum.points ?? 0;
  const testPasses = attempts.filter(a => a.type === "MODULE_TEST" || a.type === "FINAL_TEST").length;
  const earned = new Set<string>();
  if (chapters.length >= 1) earned.add("FIRST_CHAPTER");
  if (chapters.length >= 5) earned.add("FIVE_CHAPTERS");
  if (testPasses >= 1) earned.add("FIRST_TEST_PASS");
  if (projects.length >= 1) earned.add("PROJECT_APPROVED");
  if (certificates.length >= 1) earned.add("PROGRAM_COMPLETED");
  if (totalXp >= 500) earned.add("XP_500");

  for (const badgeKey of earned) {
    await prisma.userBadge.upsert({ where: { userId_badgeKey: { userId, badgeKey } }, create: { userId, badgeKey }, update: {} });
  }
  return totalXp;
}

function utcDay(date: Date) { return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()); }

export async function getStreak(userId: string) {
  const events = await prisma.xpEvent.findMany({ where: { userId }, select: { earnedAt: true }, orderBy: { earnedAt: "desc" } });
  const days = [...new Set(events.map(e => utcDay(e.earnedAt)))].sort((a, b) => b - a);
  if (!days.length) return { current: 0, longest: 0, lastActivityAt: null as Date | null };
  const oneDay = 86_400_000;
  let longest = 1, run = 1;
  for (let i = 1; i < days.length; i++) {
    if (days[i - 1]! - days[i]! === oneDay) run++; else run = 1;
    longest = Math.max(longest, run);
  }
  const today = utcDay(new Date());
  const currentEligible = days[0] === today || days[0] === today - oneDay;
  let current = currentEligible ? 1 : 0;
  if (currentEligible) for (let i = 1; i < days.length && days[i - 1]! - days[i]! === oneDay; i++) current++;
  return { current, longest, lastActivityAt: events[0]?.earnedAt ?? null };
}

export async function getBadges(userId: string) {
  const rows = await prisma.userBadge.findMany({ where: { userId }, orderBy: { earnedAt: "asc" } });
  return rows.map(row => ({ ...BADGES.find(b => b.key === row.badgeKey)!, earnedAt: row.earnedAt })).filter(b => b.key);
}

export function xpLevel(totalXp: number) {
  const level = Math.floor(totalXp / 250) + 1;
  const levelStartXp = (level - 1) * 250;
  const nextLevelXp = level * 250;
  return { level, totalXp, xpIntoLevel: totalXp - levelStartXp, xpForNextLevel: nextLevelXp - levelStartXp, nextLevelXp };
}
