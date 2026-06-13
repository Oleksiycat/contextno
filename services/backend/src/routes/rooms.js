import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { asyncRoute } from "../lib/http.js";

const router = Router();

router.get("/", asyncRoute(async (_, res) => {
  const rooms = await prisma.room.findMany({ include: { streamer: true } });
  res.json(rooms);
}));

router.post("/", asyncRoute(async (req, res) => {
  const room = await prisma.room.create({ data: req.body });
  res.status(201).json(room);
}));

router.patch("/:id", asyncRoute(async (req, res) => {
  const room = await prisma.room.update({ where: { id: req.params.id }, data: req.body });
  res.json(room);
}));

router.delete("/:id", asyncRoute(async (req, res) => {
  await prisma.room.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

export { router as roomRouter };
