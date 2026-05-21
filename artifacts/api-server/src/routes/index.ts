import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import districtsRouter from "./districts";
import tagsRouter from "./tags";
import requestsRouter from "./requests";
import reportsRouter from "./reports";
import statsRouter from "./stats";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(districtsRouter);
router.use(tagsRouter);
router.use(requestsRouter);
router.use(reportsRouter);
router.use(statsRouter);

export default router;
