import "dotenv/config";
import { z } from "zod";
const settings = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  AI_PROVIDER: z.enum(["groq", "gemini"]).default("groq"),
  GROQ_API_KEY: z.string().default(""),
  GROQ_MODEL: z.string().min(1).default("qwen/qwen3.6-27b"),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(25000),
  GEMINI_API_KEY: z.string().default(""),
  SERPER_API_KEY: z.string().default(""),
  GEMINI_MODEL: z
    .string()
    .regex(/^[a-zA-Z0-9._-]+$/)
    .default("gemini-3.6-flash"),
  APP_ORIGIN: z.string().url().default("http://localhost:5173"),
  JOB_BUDGET_MS: z.coerce.number().int().min(5000).max(120000).default(90000),
  MAX_IMAGES: z.coerce.number().int().min(5).max(30).default(30),
  DOWNLOAD_CONCURRENCY: z.coerce.number().int().min(1).max(12).default(6),
  IMAGE_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(5),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),
});
export const config = settings.parse(process.env);

export function aiConfigured() {
  return Boolean(config.AI_PROVIDER === "groq" ? config.GROQ_API_KEY : config.GEMINI_API_KEY);
}
