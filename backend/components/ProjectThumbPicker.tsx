import React, { useEffect, useState } from "react";
import { useField } from "payload/components/forms";

/**
 * ProjectThumbPicker — a custom Field for a single `relationship` to `projects`,
 * shown as a clickable grid of project KEY-IMAGE thumbnails (thumbnail-only).
 * Replaces Payload's default name-only relationship picker so a still can be
 * linked to a project visually. Reusable on any single project relationship
 * (set admin.components.Field to this). Reads/writes the field via useField, so
 * it saves exactly like the stock relationship.
 */

type Media = { url?: string; sizes?: Record<string, { url?: string } | undefined> };
type Project = { id: string; title?: string; thumb?: Media | string | null };

const thumbUrl = (t: Project["thumb"]): string => {
  if (!t || typeof t === "string") return "";
  const s = t.sizes || {};
  return (s.thumbnail?.url || s.card?.url || t.url || "") as string;
};

// A relationship value is the id (string) for a single relationTo; guard for the
// occasional { relationTo, value } object shape too.
const idOf = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as { value?: unknown; id?: unknown };
    return String(o.value ?? o.id ?? "");
  }
  return String(v);
};

const ProjectThumbPicker: React.FC<{ path: string }> = ({ path }) => {
  const { value, setValue } = useField<unknown>({ path });
  const [projects, setProjects] = useState<Project[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/projects?limit=300&depth=1&sort=title")
      .then((r) => r.json())
      .then((d) => { if (alive) setProjects(Array.isArray(d?.docs) ? d.docs : []); })
      .catch(() => { if (alive) setErr("Could not load projects."); });
    return () => { alive = false; };
  }, []);

  const selected = idOf(value);

  return (
    <div className="field-type" style={{ marginBottom: 24 }}>
      <label className="field-label">
        Project{" "}
        <span style={{ opacity: 0.5, fontWeight: 400 }}>— click a thumbnail to link (again to clear)</span>
      </label>
      {err ? <div style={{ color: "#b00", fontSize: 12, marginTop: 6 }}>{err}</div> : null}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))",
          gap: 8,
          maxHeight: 340,
          overflowY: "auto",
          marginTop: 8,
          padding: 6,
          border: "1px solid var(--theme-elevation-150, rgba(0,0,0,0.12))",
          borderRadius: 4,
        }}
      >
        {projects.map((p) => {
          const url = thumbUrl(p.thumb);
          const isSel = selected !== "" && selected === String(p.id);
          return (
            <button
              key={p.id}
              type="button"
              title={p.title || ""}
              aria-pressed={isSel}
              onClick={() => setValue(isSel ? null : p.id)}
              style={{
                position: "relative",
                padding: 0,
                margin: 0,
                cursor: "pointer",
                aspectRatio: "16 / 10",
                borderRadius: 4,
                overflow: "hidden",
                background: "var(--theme-elevation-100, #eee)",
                border: isSel
                  ? "2px solid var(--theme-success-500, #1a8f6a)"
                  : "1px solid var(--theme-elevation-200, rgba(0,0,0,0.15))",
                boxShadow: isSel ? "0 0 0 2px var(--theme-success-500, #1a8f6a)" : "none",
                opacity: selected && !isSel ? 0.72 : 1,
                transition: "opacity 120ms ease, box-shadow 120ms ease",
              }}
            >
              {url ? (
                <img
                  src={url}
                  alt={p.title || ""}
                  loading="lazy"
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              ) : (
                <span style={{ fontSize: 10, padding: 4, display: "block" }}>{p.title || "untitled"}</span>
              )}
            </button>
          );
        })}
        {projects.length === 0 && !err ? (
          <div style={{ fontSize: 12, opacity: 0.6, padding: 8 }}>Loading projects…</div>
        ) : null}
      </div>
    </div>
  );
};

export default ProjectThumbPicker;
