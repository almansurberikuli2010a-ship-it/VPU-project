import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  GraduationCap,
  ImageOff,
  Info,
  MapPin,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  CATEGORY_KEYS,
  JobResponse,
  type PhotoRecord,
  type Profile,
  type ProgressData,
  type Result,
} from "../shared/contracts";

const labels = {
  campus: "Campus",
  dormitories: "Dormitories",
  classrooms: "Classrooms",
  libraries: "Libraries",
  city: "City",
};
const filterTags = [
  ["dormitory", "Dormitory"],
  ["sports", "Sports"],
  ["laboratories", "Laboratories"],
  ["student_life", "Student life"],
] as const;
const badges = {
  verified: "Verified",
  limited_verification: "Limited verification",
  source_unavailable: "Source unavailable",
};
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "View source";
  }
};
const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="dialog-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <h2 id="dialog-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function PhotoImage({ photo }: { photo: PhotoRecord }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <div className="image-fallback">
      <ImageOff size={30} />
      <span>Image unavailable</span>
      <small>The original source is still linked below.</small>
    </div>
  ) : (
    <img
      src={photo.image_url}
      alt={photo.title}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
function PhotoCard({
  photo,
  onOpen,
}: {
  photo: PhotoRecord;
  onOpen: () => void;
}) {
  return (
    <article className="photo-card">
      <button
        className="photo-open"
        onClick={onOpen}
        aria-label={`View photo and verification report: ${photo.title}`}
      >
        <div className="photo-top">
          <span>{labels[photo.category]}</span>
          <span className={`badge ${photo.verification_status}`}>
            {photo.verification_status === "verified" && (
              <ShieldCheck size={13} />
            )}{" "}
            {badges[photo.verification_status]}
          </span>
        </div>
        <div className="photo-frame">
          <PhotoImage photo={photo} />
          <span className="photo-peek">
            <ExternalLink size={16} /> View assessment
          </span>
        </div>
        <h3>{photo.title}</h3>
      </button>
      <div className="photo-meta">
        <a
          href={photo.source}
          target="_blank"
          rel="noopener noreferrer"
          title={photo.source}
        >
          {host(photo.source)} <ExternalLink size={12} />
        </a>
        <span>
          {photo.date_kind === "retrieved" ? "Retrieved " : ""}
          {photo.date}
        </span>
      </div>
    </article>
  );
}

function Gallery({
  profile,
  open,
}: {
  profile: Profile;
  open: (photo: PhotoRecord) => void;
}) {
  const [category, setCategory] = useState("all");
  const [tags, setTags] = useState<string[]>([]);
  const [limit, setLimit] = useState(9);
  const all = CATEGORY_KEYS.flatMap((c) => profile.categories[c]);
  const photos = all.filter(
    (p) =>
      (category === "all" || p.category === category) &&
      tags.every((t) => p.tags.includes(t as PhotoRecord["tags"][number])),
  );
  const toggleTag = (tag: string) => {
    setTags((current) =>
      current.includes(tag)
        ? current.filter((t) => t !== tag)
        : [...current, tag],
    );
    setLimit(9);
  };
  return (
    <section className="profile">
      <div className="profile-heading">
        <div>
          <p className="eyebrow">YOUR VISUAL CAMPUS PROFILE</p>
          <h1>{profile.university_name}</h1>
          <p className="location">
            <MapPin size={17} />
            {profile.location}
          </p>
        </div>
        <div className="result-stat">
          <strong>{all.length}</strong>
          <span>sourced photographs</span>
        </div>
      </div>
      <p className="description">{profile.description}</p>
      <div className="description-sources">
        Profile sources:{" "}
        {profile.description_sources.map((url, i) => (
          <a
            key={`${url}-${i}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {host(url)} <ExternalLink size={11} />
          </a>
        ))}
      </div>
      {profile.data_quality === "limited" && (
        <aside className="notice">
          <Info size={21} />
          <div>
            <strong>Limited data available</strong>
            <p>
              This profile is incomplete or includes photographs with limited
              evidence.
            </p>
            <details>
              <summary>What could we verify?</summary>
              <ul>
                {profile.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </details>
          </div>
        </aside>
      )}
      <div className="filter-panel">
        <div className="categories" aria-label="Photo categories">
          {["all", ...CATEGORY_KEYS].map((c) => (
            <button
              key={c}
              className={category === c ? "selected" : ""}
              aria-pressed={category === c}
              onClick={() => {
                setCategory(c);
                setLimit(9);
              }}
            >
              {c === "all" ? "All photos" : labels[c as keyof typeof labels]}{" "}
              <span>
                {c === "all"
                  ? all.length
                  : profile.categories[c as keyof typeof labels].length}
              </span>
            </button>
          ))}
        </div>
        <div className="tags" aria-label="Additional photo filters">
          {filterTags.map(([tag, label]) => (
            <button
              key={tag}
              className={tags.includes(tag) ? "active-tag" : ""}
              aria-pressed={tags.includes(tag)}
              onClick={() => toggleTag(tag)}
            >
              {tags.includes(tag) ? <Check size={13} /> : <span>+</span>}
              {label}
            </button>
          ))}
          {tags.length > 0 && (
            <button className="clear-filters" onClick={() => setTags([])}>
              Clear filters
            </button>
          )}
        </div>
      </div>
      <div className="gallery-summary">
        <span>
          {photos.length} photograph{photos.length !== 1 ? "s" : ""}
          {tags.length > 1 ? " matching all selected filters" : ""}
        </span>
        <span>Sources linked · AI confidence is an estimate</span>
      </div>
      {photos.length ? (
        <div className="gallery">
          {photos.slice(0, limit).map((photo) => (
            <PhotoCard
              key={photo.id}
              photo={photo}
              onOpen={() => open(photo)}
            />
          ))}
        </div>
      ) : (
        <div className="empty-gallery">
          <ImageOff />
          <h2>No photographs to show</h2>
          <p>
            {all.length
              ? "Try another category or clear your filters."
              : "We found this university, but could not confirm suitable photographs from the available sources."}
          </p>
          {all.length > 0 && (
            <button
              className="secondary"
              onClick={() => {
                setCategory("all");
                setTags([]);
              }}
            >
              Show all photographs
            </button>
          )}
        </div>
      )}
      {photos.length > limit && (
        <div className="center">
          <button className="secondary" onClick={() => setLimit(limit + 9)}>
            Show more photographs <ChevronRight size={16} />
          </button>
        </div>
      )}
      <p className="search-timing">
        Elapsed {(profile.stats.elapsed_ms / 1000).toFixed(1)}s ·{" "}
        {profile.stats.assessed} images assessed ·{" "}
        {profile.stats.duplicates_removed} duplicates removed
      </p>
      {profile.diagnostics && (
        <details className="search-timing">
          <summary>Search details</summary>
          <p>
            {profile.diagnostics.candidates_selected} candidates selected ·{" "}
            {profile.stats.rejected} rejected after assessment ·{" "}
            {profile.diagnostics.download_failed} download failures ·{" "}
            {profile.diagnostics.ai_failed} AI failures
          </p>
          <p>
            {profile.diagnostics.page_reuses} repeated page downloads avoided
            {profile.diagnostics.first_photo_ms !== null
              ? ` · First photograph in ${(profile.diagnostics.first_photo_ms / 1000).toFixed(1)}s`
              : ""}
            {profile.diagnostics.budget_exhausted
              ? " · Time limit reached"
              : ""}
          </p>
        </details>
      )}
    </section>
  );
}

export function App() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [photo, setPhoto] = useState<PhotoRecord | null>(null);
  const [info, setInfo] = useState<"method" | "privacy" | null>(null);
  const [configReady, setConfigReady] = useState<boolean | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const active = useRef<{ controller: AbortController; job?: string } | null>(
    null,
  );
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then((r) => r.json())
      .then((r) => setConfigReady(r.configured === true))
      .catch(() => {});
    return () => {
      controller.abort();
      active.current?.controller.abort();
      if (active.current?.job)
        void fetch(`/api/jobs/${active.current.job}`, {
          method: "DELETE",
          keepalive: true,
        });
    };
  }, []);
  function cancel() {
    const previous = active.current;
    active.current = null;
    previous?.controller.abort();
    if (previous?.job)
      void fetch(`/api/jobs/${previous.job}`, { method: "DELETE" }).catch(
        () => {},
      );
    setProgress(null);
  }
  async function search(name: string, selection_token?: string) {
    if (name.trim().length < 2) {
      input.current?.focus();
      return;
    }
    cancel();
    const request = {
      controller: new AbortController(),
      job: undefined as string | undefined,
    };
    active.current = request;
    setQuery(name);
    setResult(null);
    setHidden([]);
    setAnnouncement("");
    setProgress({
      stage: "resolving",
      found: 0,
      assessed: 0,
      accepted: 0,
      elapsed_ms: 0,
    });
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          university_name: name,
          ...(selection_token ? { selection_token } : {}),
        }),
        signal: request.controller.signal,
      });
      const created = await response.json();
      if (!response.ok) {
        const parsed = JobResponse.parse(created);
        if (parsed.status === "processing")
          throw new Error("Invalid initial response");
        if (active.current === request) setResult(parsed);
        return;
      }
      if (typeof created.job_id !== "string")
        throw new Error("Invalid job response");
      request.job = created.job_id;
      const deadline = Date.now() + 130000;
      let transientFailures = 0;
      while (!request.controller.signal.aborted && Date.now() < deadline) {
        await delay(650, request.controller.signal);
        let response: Response;
        try {
          response = await fetch(`/api/jobs/${request.job}`, {
            signal: request.controller.signal,
          });
          transientFailures = 0;
        } catch (error) {
          if (++transientFailures < 3 && !request.controller.signal.aborted)
            continue;
          throw error;
        }
        const data = JobResponse.parse(await response.json());
        if (active.current !== request) return;
        if (data.status === "processing") {
          setProgress(data.progress);
          if (data.partial) setResult(data.partial);
        } else {
          setResult(data);
          return;
        }
      }
      throw new Error("Polling timed out");
    } catch (error) {
      if (!request.controller.signal.aborted && active.current === request) {
        setResult((previous) =>
          previous?.status === "success"
            ? {
                ...previous,
                data_quality: "limited",
                warnings: [
                  ...previous.warnings,
                  "Connection lost. Only previously completed assessments are shown.",
                ],
              }
            : {
                status: "error",
                error_code: "CONNECTION_ERROR",
                message:
                  "We could not complete this search. Check your connection and try again.",
              },
        );
        if (request.job)
          void fetch(`/api/jobs/${request.job}`, { method: "DELETE" }).catch(
            () => {},
          );
      }
    } finally {
      if (active.current === request) {
        active.current = null;
        setProgress(null);
      }
    }
  }
  function reset() {
    cancel();
    setResult(null);
    setQuery("");
    setTimeout(() => input.current?.focus(), 0);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void search(query);
  }
  const home = !result && !progress;
  const searchForm = (compact = false) => (
    <form
      className={`search-form ${compact ? "compact" : ""}`}
      onSubmit={submit}
      role="search"
    >
      <Search size={compact ? 18 : 22} />
      <input
        ref={input}
        aria-label="University name"
        placeholder="Enter university name…"
        value={query}
        minLength={2}
        maxLength={200}
        required
        onChange={(e) => setQuery(e.target.value)}
      />
      <button className="primary" type="submit">
        {compact ? (
          <Search size={18} aria-label="Search" />
        ) : (
          <>
            Build profile <ArrowRight size={18} />
          </>
        )}
      </button>
    </form>
  );
  let content: ReactNode;
  if (progress && result?.status !== "success") {
    const stages = ["resolving", "searching", "verifying", "organizing"];
    const names = [
      "Find university",
      "Search images",
      "Assess & deduplicate",
      "Build profile",
    ];
    const step = stages.indexOf(progress.stage);
    content = (
      <section className="state-panel loading-panel" aria-live="polite">
        <div className="loading-orbit">
          <GraduationCap size={36} />
        </div>
        <p className="eyebrow">A CLOSER LOOK AT YOUR NEXT CHAPTER</p>
        <h1>Building your visual profile…</h1>
        <p>
          Searching public sources and assessing photographs for
          <br className="desktop-break" /> <strong>{query}</strong>.
        </p>
        <ol className="progress-steps">
          {stages.map((stage, i) => (
            <li
              key={stage}
              className={i < step ? "done" : i === step ? "current" : ""}
            >
              <span className="step-marker">
                {i < step ? <Check size={18} /> : i + 1}
              </span>
              <strong>{names[i]}</strong>
              <small>
                {i < step
                  ? "Completed"
                  : i === step
                    ? "In progress"
                    : "Pending"}
              </small>
            </li>
          ))}
        </ol>
        <p className="progress-count">
          {progress.found} images found <span>·</span> {progress.assessed}{" "}
          assessed <span>·</span> {progress.accepted} accepted
        </p>
        <p className="muted">
          {Math.floor(progress.elapsed_ms / 1000)}s elapsed · Completed
          photographs appear as they become available
        </p>
        <button className="text-button" onClick={cancel}>
          Cancel search
        </button>
      </section>
    );
  } else if (result) {
    switch (result.status) {
      case "success": {
        const visible: Profile = {
          ...result,
          categories: { ...result.categories },
        };
        for (const key of CATEGORY_KEYS)
          visible.categories[key] = result.categories[key].filter(
            (p) => !hidden.includes(p.id),
          );
        content = (
          <>
            {progress && (
              <div className="notice" role="status">
                Still searching · {progress.assessed} assessed ·{" "}
                {progress.accepted} accepted{" "}
                <button type="button" onClick={cancel}>
                  Stop search
                </button>
              </div>
            )}
            <Gallery
              key={result.generated_at}
              profile={visible}
              open={setPhoto}
            />
          </>
        );
        break;
      }
      case "disambiguation_needed":
        content = (
          <section className="state-panel selection-panel">
            <div className="state-icon">
              <Building2 />
            </div>
            <p className="eyebrow">LET’S FIND THE RIGHT PLACE</p>
            <h1>Multiple universities found</h1>
            <p>
              There is more than one match for “{result.query}”.
              <br />
              Select the university you would like to explore.
            </p>
            <div className="candidate-list">
              {result.candidates.map((c) => (
                <button
                  key={c.id}
                  onClick={() => void search(c.name, c.selection_token)}
                >
                  <span className="candidate-icon">
                    <GraduationCap size={22} />
                  </span>
                  <span>
                    <strong>{c.name}</strong>
                    <small>
                      <MapPin size={13} />
                      {c.location}
                    </small>
                  </span>
                  <ChevronRight size={20} />
                </button>
              ))}
            </div>
            <button className="text-button" onClick={reset}>
              <ArrowLeft size={15} /> Try another search
            </button>
          </section>
        );
        break;
      case "not_found":
        content = (
          <section className="state-panel">
            <div className="state-icon">
              <Search />
            </div>
            <h1>University not found</h1>
            <p>
              We couldn’t find a supported match for “{result.query}”.
              <br />
              Check the spelling, or try the full university name and city.
            </p>
            {searchForm()}
            <div className="suggestions">
              <small>Suggested campus discoveries</small>
              <div>
                {result.suggestions.map((s) => (
                  <button key={s} onClick={() => void search(s)}>
                    {s}
                    <ArrowRight size={13} />
                  </button>
                ))}
              </div>
            </div>
          </section>
        );
        break;
      case "error":
        content = (
          <section className="state-panel">
            <div className="state-icon warning-icon">
              <CircleHelp />
            </div>
            <h1>
              {result.error_code === "SERVER_NOT_CONFIGURED"
                ? "Search is not ready yet"
                : "We couldn’t complete your search"}
            </h1>
            <p role="alert">{result.message}</p>
            <div className="error-actions">
              <button className="primary" onClick={() => void search(query)}>
                Try again
              </button>
              <button className="secondary" onClick={reset}>
                Back to search
              </button>
            </div>
            <small className="muted">Reference: {result.error_code}</small>
          </section>
        );
        break;
    }
  } else
    content = (
      <>
        <section className="hero">
          <div className="hero-label">
            <Sparkles size={14} /> AI-ASSISTED CAMPUS DISCOVERY
          </div>
          <h1>
            See your university
            <br />
            through real eyes.
          </h1>
          <p className="hero-description">
            Real photographs of campuses, dormitories, classrooms,
            <br className="desktop-break" /> libraries and cities. Sourced,
            assessed and organized.
          </p>
          {searchForm()}
          <div className="hero-proof">
            <span>
              <CheckCircle2 />
              Progressive results
            </span>
            <span>
              <CheckCircle2 />
              Transparent sources
            </span>
            <span>
              <CheckCircle2 />
              Duplicate detection
            </span>
          </div>
          {configReady === false && (
            <p className="configuration-note">
              <Info size={16} /> Search will be available once the site operator
              connects the API keys.
            </p>
          )}
        </section>
        <section className="how" id="how-it-works">
          <div className="section-heading">
            <p className="eyebrow">FROM A NAME TO A SENSE OF PLACE</p>
            <h2>How Visual Campus works</h2>
            <p>A clearer picture, with the evidence to go with it.</p>
          </div>
          <div className="how-grid">
            {[
              {
                icon: Search,
                number: "01",
                title: "Find your university",
                text: "Enter a university name. We search public sources for photographs of the places that shape student life.",
              },
              {
                icon: ShieldCheck,
                number: "02",
                title: "Look at the evidence",
                text: "AI assesses each photograph. We check source context and remove exact and visually similar images.",
              },
              {
                icon: BookOpen,
                number: "03",
                title: "Explore the details",
                text: "Browse by category, open the original sources and read what is confirmed — and what is still uncertain.",
              },
            ].map((item) => (
              <article key={item.number}>
                <div className="how-top">
                  <item.icon size={24} />
                  <span>{item.number}</span>
                </div>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </section>
      </>
    );
  return (
    <div className="app">
      <header className="header">
        <button className="brand" onClick={reset}>
          <span className="brand-icon">
            <GraduationCap size={21} />
          </span>
          Visual Campus
        </button>
        {!home && result?.status !== "not_found" && (
          <div className="header-search">{searchForm(true)}</div>
        )}
        <nav>
          <button
            className="nav-link"
            onClick={() => {
              if (home)
                document
                  .getElementById("how-it-works")
                  ?.scrollIntoView({ behavior: "smooth" });
              else setInfo("method");
            }}
          >
            How it works
          </button>
          <button className="nav-search" onClick={reset}>
            Search campus <ArrowRight size={14} />
          </button>
        </nav>
      </header>
      <main>
        {announcement && (
          <div className="announcement" role="status">
            {announcement}
          </div>
        )}
        {content}
      </main>
      <footer>
        <span>
          © {new Date().getFullYear()} Visual Campus{" "}
          <span className="footer-divider">/</span> Real places. Transparent
          sources.
        </span>
        <div>
          <button onClick={() => setInfo("method")}>
            Verification explained
          </button>
          <button onClick={() => setInfo("privacy")}>Privacy & sources</button>
        </div>
      </footer>
      {photo && (
        <Modal title="Photo spotlight" onClose={() => setPhoto(null)}>
          <div className="spotlight-image">
            <PhotoImage photo={photo} />
          </div>
          <div className="spotlight-body">
            <div className="spotlight-labels">
              <span>{labels[photo.category]}</span>
              <span className={`badge ${photo.verification_status}`}>
                {badges[photo.verification_status]}
              </span>
            </div>
            <h3>{photo.title}</h3>
            <p className="spotlight-source">
              Source:{" "}
              <a href={photo.source} target="_blank" rel="noopener noreferrer">
                {host(photo.source)} <ExternalLink size={13} />
              </a>
            </p>
            <p className="muted">
              {photo.date_kind === "retrieved" ? "Retrieved" : "Published"}:{" "}
              {photo.date}
            </p>
            <div className="verification">
              <h4>
                <ShieldCheck size={18} /> Verification report
              </h4>
              <p>{photo.reasoning}</p>
              <dl>
                <dt>Method</dt>
                <dd>{photo.verification_method}</dd>
                <dt>AI confidence</dt>
                <dd>
                  {Math.round(photo.confidence * 100)}%{" "}
                  <span className="muted">
                    — model estimate, not a guarantee
                  </span>
                </dd>
              </dl>
            </div>
            <div className="spotlight-actions">
              <button className="secondary" onClick={() => setPhoto(null)}>
                Close spotlight
              </button>
              <button
                className="text-button"
                onClick={() => {
                  setHidden((ids) => [...ids, photo.id]);
                  setAnnouncement(
                    "Photograph hidden for this session. No report has been sent.",
                  );
                  setPhoto(null);
                }}
              >
                Hide questionable photo
              </button>
            </div>
          </div>
        </Modal>
      )}
      {info && (
        <Modal
          title={
            info === "method" ? "What verification means" : "Privacy & sources"
          }
          onClose={() => setInfo(null)}
        >
          <div className="info-body">
            {info === "method" ? (
              <>
                <p>
                  Each downloaded photograph is assessed by Gemini using its
                  pixels and the available source context. The backend checks
                  the structured response before showing it.
                </p>
                <h3>Verified</h3>
                <p>
                  The model reports at least 85% confidence, and an accessible
                  page on the identified official university domain references
                  the image. This is supporting evidence, not independent proof.
                </p>
                <h3>Limited verification</h3>
                <p>
                  The model reports at least 55% confidence and considers the
                  image relevant, but the stronger source checks were not met.
                </p>
                <h3>Source unavailable</h3>
                <p>
                  The photograph was accessible, but its source page could not
                  be checked. Treat its affiliation cautiously.
                </p>
                <p>
                  Duplicates are detected using exact file hashes and visual
                  similarity hashes. We do not perform reverse image search or
                  GPS verification. AI may make mistakes; check original sources
                  before relying on a photograph.
                </p>
              </>
            ) : (
              <>
                <p>
                  Your university search is sent to Serper and Gemini. Public
                  image bytes and available source context are sent to the AI provider
                  for assessment.
                </p>
                <p>
                  This application keeps search results in server memory for up
                  to ten minutes. It does not create an account or store
                  photographs permanently. Hosting and API providers may keep
                  their own operational logs under their policies.
                </p>
                <p>
                  Photographs remain the property of their original owners.
                  Search availability does not grant a reuse license. Open the
                  original source for attribution and permission information.
                </p>
                <p>
                  The downloader respects robots.txt and skips inaccessible or
                  disallowed sources. When photographs load in your browser, the
                  original image host receives a request; no referrer is sent.
                </p>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
