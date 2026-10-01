import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";

interface AccessTokenPayload { sub: string; }
export interface AuthenticatedRequest extends Request { userId?: string; }

export const requireAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return res.status(401).json({ success: false, message: "Authentication required" });

  const token = authorization.substring(7).trim();
  if (!token) return res.status(401).json({ success: false, message: "Authentication required" });
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) return next(new Error("JWT_ACCESS_SECRET is not defined"));

  try {
    const payload = jwt.verify(token, secret, { algorithms: ["HS256"] }) as AccessTokenPayload;
    if (!payload.sub) return res.status(401).json({ success: false, message: "Invalid access token" });

    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, status: true } });
    if (!user) return res.status(401).json({ success: false, message: "Invalid access token" });
    if (user.status !== "ACTIVE") return res.status(403).json({ success: false, message: "Account is not active" });

    req.userId = user.id;
    return next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ success: false, message: "Invalid or expired access token" });
    }
    return next(error);
  }
};
