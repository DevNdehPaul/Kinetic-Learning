import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";

const buckets = new Map<string, { count: number; resetAt: number }>();

export const requestContext = (req: Request, res: Response, next: NextFunction) => {
  const requestId = typeof req.headers["x-request-id"] === "string" && req.headers["x-request-id"].length <= 100
    ? req.headers["x-request-id"]
    : randomUUID();
  res.setHeader("X-Request-Id", requestId);
  next();
};

export const createRateLimiter = (options: { windowMs: number; max: number; prefix: string }) =>
  (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const identity = req.ip || req.socket.remoteAddress || "unknown";
    const key = `${options.prefix}:${identity}`;
    const current = buckets.get(key);
    const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + options.windowMs } : current;
    bucket.count += 1;
    buckets.set(key, bucket);

    const remaining = Math.max(0, options.max - bucket.count);
    res.setHeader("RateLimit-Limit", String(options.max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > options.max) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({ success: false, message: "Too many requests. Please try again later." });
    }
    next();
  };

export const notFoundHandler = (_req: Request, res: Response) =>
  res.status(404).json({ success: false, message: "Route not found" });

export const errorHandler = (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled request error:", error);
  if (res.headersSent) return;
  return res.status(500).json({ success: false, message: "Internal server error" });
};
