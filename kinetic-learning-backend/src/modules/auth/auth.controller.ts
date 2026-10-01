import type { Request, Response } from "express";
import { loginSchema, logoutSchema, refreshTokenSchema, registerSchema } from "./auth.schema.js";
import { loginUser, logoutUser, refreshAccessToken, registerUser } from "./auth.service.js";

export const register = async (req: Request, res: Response) => {
  try {
    const validation = registerSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ success: false, message: "Validation failed", errors: validation.error.flatten().fieldErrors });
    return res.status(201).json({ success: true, message: "Registration successful", data: { user: await registerUser(validation.data) } });
  } catch (error) {
    if (error instanceof Error && error.message === "EMAIL_ALREADY_EXISTS") return res.status(409).json({ success: false, message: "An account with this email already exists" });
    console.error("Registration error:", error); return res.status(500).json({ success: false, message: "Unable to create account" });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const validation = loginSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ success: false, message: "Validation failed", errors: validation.error.flatten().fieldErrors });
    return res.status(200).json({ success: true, message: "Login successful", data: await loginUser(validation.data) });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_CREDENTIALS") return res.status(401).json({ success: false, message: "Invalid email or password" });
    if (error instanceof Error && error.message === "ACCOUNT_NOT_ACTIVE") return res.status(403).json({ success: false, message: "This account is not active" });
    console.error("Login error:", error); return res.status(500).json({ success: false, message: "Unable to login" });
  }
};

export const refresh = async (req: Request, res: Response) => {
  try {
    const validation = refreshTokenSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ success: false, message: "Validation failed", errors: validation.error.flatten().fieldErrors });
    return res.status(200).json({ success: true, message: "Access token refreshed", data: await refreshAccessToken(validation.data) });
  } catch (error) {
    if (error instanceof Error && ["INVALID_REFRESH_TOKEN", "REFRESH_TOKEN_EXPIRED"].includes(error.message)) return res.status(401).json({ success: false, message: "Invalid or expired refresh token" });
    if (error instanceof Error && error.message === "ACCOUNT_NOT_ACTIVE") return res.status(403).json({ success: false, message: "This account is not active" });
    console.error("Refresh token error:", error); return res.status(500).json({ success: false, message: "Unable to refresh access token" });
  }
};

export const logout = async (req: Request, res: Response) => {
  try {
    const validation = logoutSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ success: false, message: "Validation failed", errors: validation.error.flatten().fieldErrors });
    await logoutUser(validation.data);
    return res.status(200).json({ success: true, message: "Logout successful" });
  } catch (error) {
    console.error("Logout error:", error); return res.status(500).json({ success: false, message: "Unable to logout" });
  }
};
