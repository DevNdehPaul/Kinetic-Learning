import bcrypt from "bcrypt";
import prisma from "../../lib/prisma.js";
import { generateAccessToken, generateRefreshToken, hashToken, verifyRefreshToken } from "../../utils/jwt.js";
import type { LoginInput, LogoutInput, RefreshTokenInput, RegisterInput } from "./auth.schema.js";

const REFRESH_TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export const registerUser = async (input: RegisterInput) => {
  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) throw new Error("EMAIL_ALREADY_EXISTS");
  const passwordHash = await bcrypt.hash(input.password, 12);
  return prisma.user.create({
    data: { firstName: input.firstName, lastName: input.lastName, email: input.email, passwordHash },
    select: { id: true, firstName: true, lastName: true, email: true, role: true, status: true, emailVerified: true, createdAt: true },
  });
};

export const loginUser = async (input: LoginInput) => {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) throw new Error("INVALID_CREDENTIALS");
  if (!(await bcrypt.compare(input.password, user.passwordHash))) throw new Error("INVALID_CREDENTIALS");
  if (user.status !== "ACTIVE") throw new Error("ACCOUNT_NOT_ACTIVE");
  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);
  await prisma.refreshToken.create({ data: { userId: user.id, tokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() + REFRESH_TOKEN_LIFETIME_MS) } });
  return { user: { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, role: user.role, status: user.status, emailVerified: user.emailVerified }, accessToken, refreshToken };
};

export const refreshAccessToken = async (input: RefreshTokenInput) => {
  let payload: { sub: string; iat: number; exp: number };
  try { payload = verifyRefreshToken(input.refreshToken); } catch { throw new Error("INVALID_REFRESH_TOKEN"); }
  const storedToken = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(input.refreshToken) }, include: { user: true } });
  if (!storedToken || storedToken.revokedAt || storedToken.userId !== payload.sub) throw new Error("INVALID_REFRESH_TOKEN");
  if (storedToken.expiresAt <= new Date()) throw new Error("REFRESH_TOKEN_EXPIRED");
  if (storedToken.user.status !== "ACTIVE") throw new Error("ACCOUNT_NOT_ACTIVE");
  return { accessToken: generateAccessToken(storedToken.userId) };
};

export const logoutUser = async (input: LogoutInput) => {
  const storedToken = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(input.refreshToken) } });
  if (!storedToken || storedToken.revokedAt) return;
  await prisma.refreshToken.update({ where: { id: storedToken.id }, data: { revokedAt: new Date() } });
};
