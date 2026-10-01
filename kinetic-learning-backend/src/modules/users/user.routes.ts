import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { getMe } from "./user.controller.js";

const router = Router();

router.get("/", requireAuth, getMe);

export default router;