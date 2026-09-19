import { getMaxListeners, setMaxListeners } from "node:events";
import { createHash } from "node:crypto";
import {
  CATEGORY_KEYS,
  type Assessment,
  type PhotoRecord,
  type Profile,
  type ProgressData,
  type Result,
} from "../shared/contracts.js";
import { createLimiter } from "./queue.js";
import { config } from "./config.js";
import { AppError, errorResult } from "./errors.js";
import {
  assessImage,
  imageRecords,
  resolveUniversity,
  serper,
  type ImageRecord,
  type ResolvedUniversity,
} from "./providers.js";
import { downloadPublic, pageContainsImage, plainText } from "./network.js";
import { isDuplicate, prepareImage, type Fingerprint } from "./images.js";
import { readSelection, signSelection, universityId } from "./selection.js";

export const dependencies = {
  resolveUniversity,
  serper,
  downloadPublic,
  prepareImage,
  assessImage,
};
export type PipelineDependencies = typeof dependencies;
export function officialSource(source: string, domain: string | null): boolean {
  if (!domain) return false;
  const host = new URL(source).hostname.toLowerCase();
  return (
    host === domain.toLowerCase() || host.endsWith(`.${domain.toLowerCase()}`)
  );
}
const categoryMap = {
  campus: "campus",
  dormitory: "dormitories",
  classroom: "classrooms",
  library: "libraries",
  city: "city",
} as const;
export function makePhoto(
  hit: ImageRecord,
  assessment: Assessment,
  university: ResolvedUniversity,
  sourceAvailable: boolean,
  sourceMatches: boolean,
): PhotoRecord | null {
  if (!assessment.is_relevant || assessment.confidence < 0.55) return null;
  const supported =
    officialSource(hit.link, university.officialDomain) &&
    sourceAvailable &&
    sourceMatches;
  const status = !sourceAvailable
    ? "source_unavailable"
    : supported && assessment.confidence >= 0.85
      ? "verified"
      : "limited_verification";
  return {
    id: createHash("sha256").update(hit.imageUrl).digest("hex").slice(0, 20),
    title: hit.title,
    image_url: hit.imageUrl,
    source: hit.link,
    date: hit.date || new Date().toISOString().slice(0, 10),
    date_kind: hit.date ? "published" : "retrieved",
    verification_status: status,
    confidence: assessment.confidence,
    reasoning: assessment.reasoning, // Preserve the exact model field; never rewrite or summarize it.
    tags: [...new Set(assessment.tags)],
    category: categoryMap[assessment.category],
    duplicate_risk: assessment.duplicate_risk,
    verification_method: supported
      ? "AI image assessment + official source page referencing this image"
      : sourceAvailable
        ? "AI image assessment + available source context; affiliation not independently confirmed"
        : "AI image assessment + search metadata; source page could not be checked",
  };
}
export async function buildProfile(
  request: { university_name: string; selection_token?: string },
  signal: AbortSignal,
  update: (value: ProgressData, partial?: Profile) => void,
  deps: PipelineDependencies = dependencies,
): Promise<Result> {
  // Bounded candidate queues and in-flight fetches intentionally share cancellation.
  if (getMaxListeners(signal) < 100) setMaxListeners(100, signal);
  const started = Date.now();
  const generated_at = new Date(started).toISOString();
  let snapshot: (() => Profile) | undefined;
  const stats = {
    found: 0,
    assessed: 0,
    accepted: 0,
    duplicates_removed: 0,
    rejected: 0,
    unavailable: 0,
    elapsed_ms: 0,
  };
  const emit = (stage: ProgressData["stage"]) =>
    update(
      {
        stage,
        found: stats.found,
        assessed: stats.assessed,
        accepted: stats.accepted,
        elapsed_ms: Date.now() - started,
      },
      stats.accepted ? snapshot?.() : undefined,
    );
  emit("resolving");
  let universities: ResolvedUniversity[];
  try {
    universities = request.selection_token
      ? [readSelection(request.selection_token)]
      : await deps.resolveUniversity(request.university_name, signal);
  } catch (e) {
    return errorResult(e);
  }
  if (!universities.length)
    return {
      status: "not_found",
      query: request.university_name,
      suggestions: [
        "Harvard University",
        "Stanford University",
        "University of Oxford",
      ],
    };
  if (universities.length > 1)
    return {
      status: "disambiguation_needed",
      query: request.university_name,
      candidates: universities.map((u) => ({
        id: universityId(u),
        name: u.name,
        location: u.location,
        selection_token: signSelection(u),
      })),
    };
  const university = universities[0];
  emit("searching");
  const warnings: string[] = [];
  const queryBase = `"${university.name.replaceAll('"', "")}" ${university.location}`;
  const queries = [
    `${queryBase} campus buildings photos`,
    `${queryBase} student dormitory room`,
    `${queryBase} classroom lecture hall laboratory`,
    `${queryBase} library interior`,
    university.city
      ? `${university.city} ${university.location} city streets`
      : `${queryBase} surrounding city`,
    `${queryBase} sports facilities student life`,
  ];
  const lists: ImageRecord[][] = queries.map(() => []);
  const urls = new Set<string>();
  const discovered = new Set<string>();
  const pending: Promise<void>[] = [];
  const downloadSlot = createLimiter(config.DOWNLOAD_CONCURRENCY);
  const aiSlot = createLimiter(config.IMAGE_CONCURRENCY);
  const pages = new Map<
    string,
    ReturnType<PipelineDependencies["downloadPublic"]>
  >();
  const diagnostics = {
    candidates_selected: 0,
    page_fetches: 0,
    page_reuses: 0,
    download_failed: 0,
    ai_failed: 0,
    first_photo_ms: null as number | null,
    budget_exhausted: false,
  };
  const fingerprints: Fingerprint[] = [];
  const photos: PhotoRecord[] = [];
  let downloaded = 0;
  const failures: unknown[] = [];
  emit("verifying");
  snapshot = () => {
    const categories: Profile["categories"] = {
      campus: [],
      dormitories: [],
      classrooms: [],
      libraries: [],
      city: [],
    };
    [...photos]
      .sort((a, b) => b.confidence - a.confidence)
      .forEach((p) => categories[p.category].push(p));
    return {
      status: "success",
      university_name: university.name,
      location: university.location,
      description:
        university.description ||
        "A visual profile assembled from the sources listed below.",
      description_sources: university.sources,
      categories,
      data_quality: "limited",
      warnings: ["Search is incomplete. Only completed assessments are shown."],
      missing_categories: CATEGORY_KEYS.filter((k) => !categories[k].length),
      stats: { ...stats, elapsed_ms: Date.now() - started },
      diagnostics: { ...diagnostics },
      generated_at,
    };
  };
  const worker = async (hit: ImageRecord) => {
    let phase: "download" | "ai" = "download";
    try {
      const { source, prepared } = await downloadSlot(async () => {
        let page = pages.get(hit.link);
        if (page) diagnostics.page_reuses++;
        else {
          diagnostics.page_fetches++;
          page = deps.downloadPublic(hit.link, signal, "page");
          pages.set(hit.link, page);
        }
        const [image, source] = await Promise.all([
          deps.downloadPublic(hit.imageUrl, signal, "image"),
          page.catch(() => null),
        ]);
        signal.throwIfAborted();
        const prepared = await deps.prepareImage(image.body);
        return { source, prepared };
      }, signal);
      signal.throwIfAborted();
      signal.throwIfAborted();
      downloaded++;
      // This synchronous check + insert is atomic between worker awaits.
      if (fingerprints.some((f) => isDuplicate(f, prepared.fingerprint))) {
        stats.duplicates_removed++;
        return;
      }
      fingerprints.push(prepared.fingerprint);
      const html = source?.body.toString("utf8") ?? "";
      const sourceMatches = Boolean(
        source && pageContainsImage(html, hit.imageUrl),
      );
      phase = "ai";
      const assessment = await aiSlot(
        () =>
          deps.assessImage(
            {
              university_name: university.name,
              image_url: hit.imageUrl,
              image_context: JSON.stringify({
                university_location: university.location,
                city: university.city,
                title_from_search: hit.title,
                source_url: hit.link,
                source_page_available: Boolean(source),
                source_page_references_image: sourceMatches,
                source_on_identified_official_domain: officialSource(
                  source?.finalUrl ?? hit.link,
                  university.officialDomain,
                ),
                source_text: plainText(html),
              }),
            },
            prepared.jpeg,
            signal,
          ),
        signal,
      );
      signal.throwIfAborted();
      stats.assessed++;
      // An official URL redirecting away is not official evidence.
      const sameOfficial =
        source && officialSource(source.finalUrl, university.officialDomain);
      const photo = makePhoto(
        hit,
        assessment,
        university,
        Boolean(source),
        sourceMatches && Boolean(sameOfficial),
      );
      if (photo) {
        photos.push(photo);
        stats.accepted++;
        diagnostics.first_photo_ms ??= Date.now() - started;
      } else stats.rejected++;
    } catch (e) {
      failures.push(e);
      stats.unavailable++;
      if (!signal.aborted) {
        if (phase === "ai") diagnostics.ai_failed++;
        else diagnostics.download_failed++;
      }
    } finally {
      if (!signal.aborted) emit("verifying");
    }
  };
  const enqueue = (hit: ImageRecord) => {
    if (signal.aborted || diagnostics.candidates_selected >= config.MAX_IMAGES)
      return false;
    const url = new URL(hit.imageUrl);
    url.hash = "";
    if (urls.has(url.href)) return false;
    urls.add(url.href);
    diagnostics.candidates_selected++;
    pending.push(worker(hit));
    return true;
  };
  // Reserve a fair initial share for every category; start before the slowest search finishes.
  const searches = await Promise.allSettled(
    queries.map(async (q, index) => {
      const list = imageRecords(await deps.serper("images", q, signal));
      list.sort(
        (a, b) =>
          Number(officialSource(b.link, university.officialDomain)) -
          Number(officialSource(a.link, university.officialDomain)),
      );
      lists[index] = list;
      stats.found += list.length;
      for (const hit of list) {
        const url = new URL(hit.imageUrl);
        url.hash = "";
        if (discovered.has(url.href)) stats.duplicates_removed++;
        else discovered.add(url.href);
      }
      let selected = 0;
      const quota =
        Math.floor(config.MAX_IMAGES / queries.length) +
        Number(index < config.MAX_IMAGES % queries.length);
      for (const hit of list) {
        if (selected >= quota) break;
        if (enqueue(hit)) selected++;
      }
      emit("verifying");
    }),
  );
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++)
    for (const list of lists) if (list[i]) enqueue(list[i]);
  await Promise.all(pending);
  diagnostics.budget_exhausted = signal.aborted;
  const successful = searches.filter((s) => s.status === "fulfilled");
  if (!successful.length) {
    const first = searches.find((s) => s.status === "rejected");
    return errorResult(
      first?.status === "rejected"
        ? first.reason
        : new AppError(
            "SEARCH_API_UNAVAILABLE",
            "Image search is unavailable.",
          ),
    );
  }
  if (successful.length !== searches.length)
    warnings.push(
      "Some image searches were unavailable. This profile may be incomplete.",
    );
  if (
    !photos.length &&
    stats.assessed === 0 &&
    failures.length &&
    downloaded > 0 &&
    !signal.aborted
  ) {
    const aiError = failures.find(
      (e) => e instanceof AppError && e.code.startsWith("AI_"),
    );
    if (aiError) return errorResult(aiError);
  }
  if (!photos.length && signal.aborted) return errorResult(signal.reason);
  if (signal.aborted)
    warnings.push(
      "The time limit was reached. Only completed assessments are shown.",
    );
  if (stats.unavailable)
    warnings.push(
      "Some images or assessments were unavailable and were omitted.",
    );
  if (!photos.length)
    warnings.push(
      "The university was found, but no photographs could be reliably associated with it.",
    );
  if (photos.some((p) => p.verification_status !== "verified"))
    warnings.push(
      "Some photographs have limited evidence. Open a photograph to read its assessment.",
    );
  emit("organizing");
  const categories: Profile["categories"] = {
    campus: [],
    dormitories: [],
    classrooms: [],
    libraries: [],
    city: [],
  };
  photos
    .sort((a, b) => b.confidence - a.confidence)
    .forEach((photo) => categories[photo.category].push(photo));
  const missing = CATEGORY_KEYS.filter((key) => !categories[key].length);
  if (missing.length)
    warnings.push(`No supported photographs found for: ${missing.join(", ")}.`);
  stats.elapsed_ms = Date.now() - started;
  return {
    status: "success",
    university_name: university.name,
    location: university.location,
    description:
      university.description ||
      "A visual profile assembled from the sources listed below.",
    description_sources: university.sources,
    categories,
    data_quality:
      missing.length || warnings.length || photos.length < 5
        ? "limited"
        : "complete",
    warnings: [...new Set(warnings)],
    missing_categories: missing,
    stats,
    diagnostics,
    generated_at,
  };
}
