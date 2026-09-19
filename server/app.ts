import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { existsSync } from "node:fs";
import { config, aiConfigured } from "./config.js";
import { buildProfile } from "./pipeline.js";
import { errorResult } from "./errors.js";
import {
  ProfileResult,
  SearchRequest,
  type Result,
  type Profile,
  type ProgressData,
} from "../shared/contracts.js";

export function createApp(
  options: { pipeline?: typeof buildProfile; configured?: boolean } = {},
) {
  const app = express();
  const configured =
    options.configured ??
    Boolean(aiConfigured() && config.SERPER_API_KEY);
  const pipeline = options.pipeline ?? buildProfile;
  const jobs = new Map<
    string,
    {
      created: number;
      controller: AbortController;
      progress: ProgressData;
      result?: Result;
      partial?: Profile;
    }
  >();
  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY_HOPS);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "https:", "http:", "data:"],
          connectSrc: ["'self'"],
          upgradeInsecureRequests: null,
        },
      },
    }),
  );
  app.use(express.json({ limit: "24kb" }));
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get("/api/health", (_req, res) => res.json({ status: "ok", configured }));
  const searches = rateLimit({
    windowMs: 60000,
    limit: 6,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      status: "error",
      error_code: "RATE_LIMITED",
      message: "Too many searches. Please wait a minute and try again.",
    },
  });
  app.post("/api/jobs", searches, (req, res) => {
    const origin = req.headers.origin;
    if (origin && origin !== new URL(config.APP_ORIGIN).origin) {
      return res.status(403).json({
        status: "error",
        error_code: "ORIGIN_NOT_ALLOWED",
        message: "This request origin is not allowed.",
      });
    }
    const request = SearchRequest.safeParse(req.body);
    if (!request.success)
      return res.status(400).json({
        status: "error",
        error_code: "INVALID_REQUEST",
        message: "Enter a university name between 2 and 200 characters.",
      });
    if (!configured)
      return res.status(503).json({
        status: "error",
        error_code: "SERVER_NOT_CONFIGURED",
        message:
          "Search is not configured yet. The site operator must add the selected AI provider and Serper API keys.",
      });
    for (const [id, job] of jobs)
      if (Date.now() - job.created > 600000) {
        job.controller.abort();
        jobs.delete(id);
      }
    const active = [...jobs.values()].filter((job) => !job.result).length;
    if (active >= 3 || jobs.size >= 100)
      return res.status(503).json({
        status: "error",
        error_code: "SERVER_BUSY",
        message: "The search service is busy. Please try again shortly.",
      });
    const jobId = randomBytes(24).toString("base64url");
    const job = {
      created: Date.now(),
      controller: new AbortController(),
      progress: {
        stage: "resolving",
        found: 0,
        assessed: 0,
        accepted: 0,
        elapsed_ms: 0,
      } as ProgressData,
      result: undefined as Result | undefined,
      partial: undefined as Profile | undefined,
    };
    jobs.set(jobId, job);
    const expiration = setTimeout(() => {
      job.controller.abort();
      jobs.delete(jobId);
    }, 600000);
    expiration.unref();
    const timeout = setTimeout(
      () =>
        job.controller.abort(
          new DOMException("Search time limit reached", "TimeoutError"),
        ),
      config.JOB_BUDGET_MS,
    );
    timeout.unref();
    void pipeline(request.data, job.controller.signal, (progress, partial) => {
      job.progress = progress;
      if (partial) job.partial = partial;
    })
      .then((result) => {
        job.result = ProfileResult.parse(result);
      })
      .catch((error) => {
        job.result = errorResult(error);
      })
      .finally(() => clearTimeout(timeout));
    return res.status(202).json({ job_id: jobId });
  });
  app.get("/api/jobs/:id", (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job || Date.now() - job.created > 600000)
      return res.status(404).json({
        status: "error",
        error_code: "JOB_EXPIRED",
        message: "This search has expired. Please search again.",
      });
    return res.json(
      job.result ?? {
        status: "processing",
        partial: job.partial,
        progress: { ...job.progress, elapsed_ms: Date.now() - job.created },
      },
    );
  });
  app.delete("/api/jobs/:id", (req, res) => {
    const job = jobs.get(req.params.id);
    if (job) {
      job.controller.abort(new DOMException("Cancelled", "AbortError"));
      jobs.delete(req.params.id);
    }
    return res.status(204).end();
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({
      status: "error",
      error_code: "ENDPOINT_NOT_FOUND",
      message: "API endpoint not found.",
    }),
  );
  const client = path.resolve("dist/client");
  if (existsSync(path.join(client, "index.html"))) {
    app.use(express.static(client, { index: false, maxAge: "1h" }));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(path.join(client, "index.html")),
    );
  }
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (
        error instanceof SyntaxError ||
        (typeof error === "object" &&
          error &&
          "type" in error &&
          error.type === "entity.too.large")
      )
        return res.status(400).json({
          status: "error",
          error_code: "INVALID_REQUEST",
          message: "Invalid JSON or request too large.",
        });
      return res.status(500).json(errorResult(error));
    },
  );
  return app;
}
