import crypto from "crypto";
import jwt from "jsonwebtoken";

const accessSecret = process.env.JWT_ACCESS_SECRET;
const refreshSecret = process.env.JWT_REFRESH_SECRET;

if (!accessSecret) throw new Error("JWT_ACCESS_SECRET is not defined");
if (!refreshSecret) throw new Error("JWT_REFRESH_SECRET is not defined");

export const generateAccessToken = (userId: string) =>
  jwt.sign({ sub: userId }, accessSecret, { expiresIn: "15m" });

export const generateRefreshToken = (userId: string) =>
  jwt.sign({ sub: userId }, refreshSecret, { expiresIn: "7d" });

export const verifyRefreshToken = (token: string) =>
  jwt.verify(token, refreshSecret, { algorithms: ["HS256"] }) as { sub: string; iat: number; exp: number };

export const hashToken = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");
