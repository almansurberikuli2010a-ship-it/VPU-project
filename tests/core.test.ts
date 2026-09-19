import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  ImageAssessment,
  ImageAssessmentInput,
  ProfileResult,
} from "../shared/contracts.js";
import {
  isPublicAddress,
  validateUrl,
  pageContainsImage,
} from "../server/network.js";
import { isDuplicate, prepareImage } from "../server/images.js";
import {
  makePhoto,
  officialSource,
  buildProfile,
  type PipelineDependencies,
} from "../server/pipeline.js";
import { readSelection, signSelection } from "../server/selection.js";
import { AppError } from "../server/errors.js";
import type { ResolvedUniversity, ImageRecord } from "../server/providers.js";

const university: ResolvedUniversity = {
  name: "Test University",
  location: "Test City",
  city: "Test City",
  description: "A test fixture, not a real profile.",
  sources: ["https://test.example.edu/about"],
  officialDomain: "test.example.edu",
};
const hit: ImageRecord = {
  title: "Test campus photo",
  imageUrl: "https://test.example.edu/images/campus.jpg",
  link: "https://test.example.edu/gallery",
};
const assessment = ImageAssessment.parse({
  category: "campus",
  is_relevant: true,
  confidence: 0.95,
  reasoning: "  Exact evidence text\nkept unchanged.  ",
  duplicate_risk: "unknown",
  tags: ["architecture", "outdoor"],
});
const signal = () => new AbortController().signal;
const deps = (
  overrides: Partial<PipelineDependencies> = {},
): PipelineDependencies => ({
  resolveUniversity: async () => [university],
  serper: async () => ({ images: [hit] }),
  downloadPublic: async (url, _signal, kind) => ({
    body: Buffer.from(
      kind === "image"
        ? "test image bytes"
        : `<html><img src="${hit.imageUrl}"></html>`,
    ),
    contentType: kind === "image" ? "image/jpeg" : "text/html",
    finalUrl: url,
    status: 200,
  }),
  prepareImage: async () => ({
    jpeg: Buffer.from("test JPEG"),
    fingerprint: { exact: "fixture", hash: 12n, mean: 130, deviation: 50 },
  }),
  assessImage: async () => assessment,
  ...overrides,
});

test("three contracts cannot be substituted for each other; malformed AI confidence and tags fail", () => {
  const input = {
    university_name: university.name,
    image_url: hit.imageUrl,
    image_context: "source context",
  };
  assert(ImageAssessmentInput.safeParse(input).success);
  assert(!ImageAssessment.safeParse(input).success);
  assert(!ProfileResult.safeParse(assessment).success);
  assert(
    !ImageAssessment.safeParse({ ...assessment, confidence: "0.95" }).success,
  );
  assert(
    !ImageAssessment.safeParse({ ...assessment, confidence: 1.1 }).success,
  );
  assert(
    !ImageAssessment.safeParse({ ...assessment, tags: ["unrecognized"] })
      .success,
  );
  assert(
    !ImageAssessment.safeParse({
      ...assessment,
      "is\\_relevant": true,
      is_relevant: undefined,
    }).success,
  );
});
test("private IPv4, mapped IPv6, loopback, link-local, CGNAT and reserved addresses are rejected", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.1.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.1.1",
    "0.0.0.0",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
  ])
    assert.equal(isPublicAddress(address), false, address);
  assert(isPublicAddress("8.8.8.8"));
  assert(isPublicAddress("2606:4700:4700::1111"));
});
test("unsafe URL schemes, credentials, hostnames, encodings and ports are blocked", () => {
  for (const url of [
    "file:///etc/passwd",
    "http://user:pass@example.com",
    "http://localhost/a",
    "http://2130706433/a",
    "http://0x7f000001/a",
    "http://[::1]/a",
    "https://example.com:8080/a",
  ])
    assert.throws(() => validateUrl(url));
  assert.equal(
    validateUrl("https://example.com/photo.jpg").hostname,
    "example.com",
  );
});
test("official domain matching accepts subdomains but rejects lookalikes", () => {
  assert(officialSource("https://studentlife.mit.edu/simmons", "mit.edu"));
  assert(!officialSource("https://mit.edu.evil.test/simmons", "mit.edu"));
  assert(!officialSource("https://notmit.edu/simmons", "mit.edu"));
});
test("verification requires source evidence in addition to model confidence; reasoning is unchanged", () => {
  const verified = makePhoto(hit, assessment, university, true, true)!;
  assert.equal(verified.verification_status, "verified");
  assert.equal(verified.reasoning, assessment.reasoning);
  assert.equal(verified.date_kind, "retrieved");
  assert.equal(
    makePhoto(hit, assessment, university, true, false)!.verification_status,
    "limited_verification",
  );
  assert.equal(
    makePhoto(
      { ...hit, link: "https://blog.example.com" },
      assessment,
      university,
      true,
      true,
    )!.verification_status,
    "limited_verification",
  );
  assert.equal(
    makePhoto(hit, assessment, university, false, false)!.verification_status,
    "source_unavailable",
  );
  assert.equal(
    makePhoto(hit, { ...assessment, confidence: 0.31 }, university, true, true),
    null,
  );
  assert.equal(
    makePhoto(
      hit,
      { ...assessment, is_relevant: false },
      university,
      true,
      true,
    ),
    null,
  );
});
test("category mapping is separate from multiple tags", () => {
  const photo = makePhoto(
    hit,
    {
      ...assessment,
      category: "dormitory",
      tags: ["dormitory", "student_life"],
    },
    university,
    true,
    true,
  )!;
  assert.equal(photo.category, "dormitories");
  assert.deepEqual(photo.tags, ["dormitory", "student_life"]);
});
test("source reference recognizes escaped query strings without treating any source as matching", () => {
  assert(
    pageContainsImage(
      '<img src="https://example.com/images/campus-view.jpg?a=1&amp;b=2">',
      "https://example.com/images/campus-view.jpg?a=1&b=2",
    ),
  );
  assert(
    !pageContainsImage(
      '<img src="/other.jpg">',
      "https://example.com/images/campus-view.jpg",
    ),
  );
});
test("actual image decoding rejects invalid bytes and duplicate hashing survives JPEG recompression", async () => {
  const raw = Buffer.alloc(128 * 128 * 3);
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++)
      for (let c = 0; c < 3; c++)
        raw[(y * 128 + x) * 3 + c] = (x * 3 + y * 2) % 255;
  const a = await sharp(raw, { raw: { width: 128, height: 128, channels: 3 } })
    .png()
    .toBuffer();
  const b = await sharp(a).jpeg({ quality: 75 }).toBuffer();
  const first = await prepareImage(a),
    second = await prepareImage(b);
  assert(isDuplicate(first.fingerprint, second.fingerprint));
  await assert.rejects(prepareImage(Buffer.from("not an image")));
  assert(
    !isDuplicate(
      { exact: "a", hash: 0n, mean: 128, deviation: 0 },
      { exact: "b", hash: 0n, mean: 128, deviation: 0 },
    ),
  );
});
test("university selection tokens reject client tampering", () => {
  const token = signSelection(university);
  assert.deepEqual(readSelection(token), university);
  const forged = Buffer.from(
    JSON.stringify({
      exp: Date.now() + 10000,
      university: { ...university, officialDomain: "evil.test" },
    }),
  ).toString("base64url");
  assert.throws(() => readSelection(`${forged}.${token.split(".")[1]}`));
});
test("pipeline returns genuine final success contract with missing categories and no duplicate cards", async () => {
  const result = await buildProfile(
    { university_name: "Test" },
    signal(),
    () => {},
    deps(),
  );
  assert(ProfileResult.safeParse(result).success);
  assert.equal(result.status, "success");
  if (result.status !== "success") return;
  assert.equal(result.categories.campus.length, 1);
  assert.equal(result.categories.campus[0].reasoning, assessment.reasoning);
  assert.equal(result.data_quality, "limited");
  assert(result.missing_categories.includes("libraries"));
  assert(result.stats.duplicates_removed > 0);
});
test("pipeline distinguishes ambiguous university and absent university", async () => {
  const ambiguous = await buildProfile(
    { university_name: "TU" },
    signal(),
    () => {},
    deps({
      resolveUniversity: async () => [
        university,
        { ...university, name: "Second Test University" },
      ],
    }),
  );
  assert.equal(ambiguous.status, "disambiguation_needed");
  if (ambiguous.status === "disambiguation_needed")
    assert.equal(ambiguous.candidates.length, 2);
  const missing = await buildProfile(
    { university_name: "Unknown" },
    signal(),
    () => {},
    deps({ resolveUniversity: async () => [] }),
  );
  assert.equal(missing.status, "not_found");
});
test("search provider outage and invalid AI JSON are errors, not university-not-found", async () => {
  const unavailable = await buildProfile(
    { university_name: "Test" },
    signal(),
    () => {},
    deps({
      serper: async () => {
        throw new AppError("SEARCH_API_UNAVAILABLE", "Unavailable");
      },
    }),
  );
  assert.equal(unavailable.status, "error");
  if (unavailable.status === "error")
    assert.equal(unavailable.error_code, "SEARCH_API_UNAVAILABLE");
  const ai = await buildProfile(
    { university_name: "Test" },
    signal(),
    () => {},
    deps({
      assessImage: async () => {
        throw new AppError("AI_INVALID_RESPONSE", "Invalid response");
      },
    }),
  );
  assert.equal(ai.status, "error");
  if (ai.status === "error") assert.equal(ai.error_code, "AI_INVALID_RESPONSE");
});
test("all irrelevant images give limited data, without invented photos", async () => {
  const result = await buildProfile(
    { university_name: "Test" },
    signal(),
    () => {},
    deps({ assessImage: async () => ({ ...assessment, is_relevant: false }) }),
  );
  assert.equal(result.status, "success");
  if (result.status === "success") {
    assert.equal(result.stats.accepted, 0);
    assert.equal(result.data_quality, "limited");
  }
});
test("official source redirect to a third-party domain cannot produce Verified", async () => {
  const base = deps();
  const result = await buildProfile(
    { university_name: "Test" },
    signal(),
    () => {},
    deps({
      downloadPublic: async (url, s, kind) => ({
        ...(await base.downloadPublic(url, s, kind)),
        finalUrl: "https://untrusted.example.net/photo",
      }),
    }),
  );
  if (result.status !== "success") assert.fail("Expected success");
  assert.equal(
    result.categories.campus[0].verification_status,
    "limited_verification",
  );
});
test("deadline preserves completed assessments and explicitly marks partial results", async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = await buildProfile(
    { university_name: "Test" },
    controller.signal,
    (progress) => {
      if (progress.accepted === 1 && ++calls === 1)
        controller.abort(new DOMException("Deadline", "TimeoutError"));
    },
    deps(),
  );
  if (result.status !== "success") assert.fail("Expected partial result");
  assert.equal(result.stats.accepted, 1);
  assert(result.warnings.some((w) => w.includes("time limit")));
});

test("partial cards arrive before slow searches finish; pages are shared and downloads overlap AI", async () => {
  let releaseSearch!: () => void;
  const slowSearch = new Promise<void>((resolve) => {
    releaseSearch = resolve;
  });
  let releaseAI!: () => void;
  const slowAI = new Promise<void>((resolve) => {
    releaseAI = resolve;
  });
  let searches = 0,
    pageFetches = 0,
    imageFetches = 0,
    aiCalls = 0;
  let partialBeforeSearchEnd = false;
  let fallbackFired = false;
  const timer = setTimeout(() => {
    fallbackFired = true;
    releaseAI();
    releaseSearch();
  }, 2000);
  const base = deps();
  try {
    const result = await buildProfile(
      { university_name: "Test" },
      signal(),
      (_p, partial) => {
        if (partial && !partialBeforeSearchEnd) {
          partialBeforeSearchEnd = true;
          releaseSearch();
        }
      },
      deps({
        serper: async () => {
          if (++searches === 6) await slowSearch;
          return {
            images: Array.from({ length: 10 }, (_, i) => ({
              ...hit,
              imageUrl: `https://test.example.edu/${i}.jpg`,
            })),
          };
        },
        downloadPublic: async (url, s, kind) => {
          if (kind === "page") pageFetches++;
          else {
            imageFetches++;
            if (imageFetches >= 6) releaseAI();
          }
          return {
            ...(await base.downloadPublic(url, s, kind)),
            body: Buffer.from(kind === "image" ? url : "source"),
          };
        },
        prepareImage: async (bytes) => ({
          jpeg: bytes,
          fingerprint: {
            exact: bytes.toString(),
            hash: 0n,
            mean: 0,
            deviation: 0,
          },
        }),
        assessImage: async () => {
          aiCalls++;
          await slowAI;
          return assessment;
        },
      }),
    );
    assert.equal(
      fallbackFired,
      false,
      "processing stalled behind AI or slow search",
    );
    assert.equal(partialBeforeSearchEnd, true);
    assert.equal(pageFetches, 1);
    assert.equal(aiCalls, 10);
    assert.equal(result.status, "success");
    if (result.status === "success") {
      assert.equal(result.stats.accepted, 10);
      assert.equal(result.diagnostics?.page_reuses, 9);
      assert.notEqual(result.diagnostics?.first_photo_ms, null);
    }
  } finally {
    clearTimeout(timer);
    releaseAI();
    releaseSearch();
  }
});
