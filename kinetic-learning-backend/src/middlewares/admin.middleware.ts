import type { NextFunction, Response } from "express";
import prisma from "../lib/prisma.js";
import type { AuthenticatedRequest } from "./auth.middleware.js";

export const requireAdmin = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.userId) return res.status(401).json({ success: false, message: "Authentication required" });

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true, status: true },
    });

    if (!user || user.status !== "ACTIVE") {
      return res.status(403).json({ success: false, message: "Account is not active" });
    }

    if (user.role !== "ADMIN") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    next();
  } catch (error) {
    console.error("Admin authorization error:", error);
    return res.status(500).json({ success: false, message: "Unable to authorize request" });
  }
};
