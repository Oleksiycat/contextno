import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { asyncRoute } from "../lib/http.js";

const router = Router();

router.get("/overview", asyncRoute(async (_, res) => {
  const [users, rounds, messages, winners] = await Promise.all([
    prisma.user.count(),
    prisma.round.count(),
    prisma.message.count(),
    prisma.winner.count(),
  ]);
  res.json({ users, rounds, messages, winners });
}));

export { router as statsRouter };
