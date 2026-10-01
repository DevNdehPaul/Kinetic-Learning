import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../../middlewares/auth.middleware.js";
import prisma from "../../lib/prisma.js";
import { getMe } from "./user.controller.js";

const router = Router();
router.use(requireAuth);
router.get("/", getMe);

const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
}).refine(v => v.firstName !== undefined || v.lastName !== undefined, { message: "At least one profile field is required" });

router.patch("/", async (req: AuthenticatedRequest, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success:false, message:"Invalid profile data", errors:parsed.error.flatten() });
  try {
    const user = await prisma.user.update({
      where:{ id:req.userId! }, data:parsed.data,
      select:{ id:true,firstName:true,lastName:true,email:true,role:true,status:true,emailVerified:true,createdAt:true,updatedAt:true }
    });
    return res.json({ success:true, message:"Profile updated", data:{user} });
  } catch (error) {
    console.error("Update profile error:", error);
    return res.status(500).json({ success:false, message:"Unable to update profile" });
  }
});

router.delete("/", async (req: AuthenticatedRequest, res) => {
  try {
    await prisma.user.delete({ where:{id:req.userId!} });
    return res.json({ success:true, message:"Account deleted" });
  } catch (error) {
    console.error("Delete account error:", error);
    return res.status(500).json({ success:false, message:"Unable to delete account" });
  }
});
export default router;
