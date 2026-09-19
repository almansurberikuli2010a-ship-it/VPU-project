import {
  createHmac,
  randomBytes,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { z } from "zod";
import { AppError } from "./errors.js";
import type { ResolvedUniversity } from "./providers.js";
const key = randomBytes(32);
const Selection = z.object({
  exp: z.number(),
  university: z.object({
    name: z.string(),
    location: z.string(),
    description: z.string(),
    city: z.string(),
    sources: z.array(z.string().url()),
    officialDomain: z.string().nullable(),
  }),
});
export const universityId = (university: ResolvedUniversity) =>
  createHash("sha256")
    .update(`${university.name}|${university.location}`)
    .digest("hex")
    .slice(0, 20);
export function signSelection(university: ResolvedUniversity): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + 10 * 60000, university }),
  ).toString("base64url");
  return `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
}
export function readSelection(token: string): ResolvedUniversity {
  try {
    const [payload, signature, extra] = token.split(".");
    const expected = createHmac("sha256", key).update(payload).digest();
    const received = Buffer.from(signature ?? "", "base64url");
    if (
      extra ||
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    )
      throw new Error();
    const data = Selection.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString()),
    );
    if (data.exp < Date.now()) throw new Error();
    return data.university;
  } catch {
    throw new AppError(
      "SELECTION_EXPIRED",
      "This selection has expired. Please search again.",
      400,
    );
  }
}
