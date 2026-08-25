import { mediaUrl } from '@/lib/payload';

// Minimal serializer for Payload's Slate rich-text JSON → HTML string.
//
// Payload's slate editor stores a value as an array of nodes: leaves carry
// `text` plus optional marks (bold/italic/…), elements carry a `type` and
// `children`. The default block (no `type`) is a paragraph. We render the
// handful of node types the write-up uses and fall back to <p> for anything
// unrecognised. Text is escaped — the CMS is trusted, but rendered via set:html.
//
// `upload` nodes are how inline media gets in: Payload stores the media id in
// `value` and populates it into the whole doc at depth >= 1 (the project fetch
// runs depth=2), so by the time we see it, `value` is the media document and
// carries url/mimeType/width/height. `fields` holds the per-insert options
// declared on the field in collections/Projects.ts.

interface MediaDoc {
  url?: string;
  alt?: string;
  mimeType?: string;
  width?: number;
  height?: number;
}

interface SlateNode {
  text?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  code?: boolean;
  type?: string;
  url?: string;
  newTab?: boolean;
  /** Set by the toolbar's alignment buttons; lives on the block node. */
  textAlign?: string;
  /** `upload` nodes: the populated media doc (or a bare id at depth 0). */
  value?: MediaDoc | string;
  relationTo?: string;
  /** `upload` nodes: the per-insert options (span, caption). */
  fields?: { span?: string; caption?: string };
  children?: SlateNode[];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function serializeLeaf(node: SlateNode): string {
  let text = escapeHtml(node.text ?? '');
  if (text === '') return '';
  if (node.code) text = `<code>${text}</code>`;
  if (node.bold) text = `<strong>${text}</strong>`;
  if (node.italic) text = `<em>${text}</em>`;
  if (node.underline) text = `<u>${text}</u>`;
  if (node.strikethrough) text = `<s>${text}</s>`;
  return text;
}

/** Alignment is a property on the block node, not a wrapper element. */
function alignAttr(node: SlateNode): string {
  const a = node.textAlign;
  return a === 'center' || a === 'right' || a === 'left' ? ` style="text-align:${a}"` : '';
}

/** An `upload` node → a <figure> holding an <img> or a <video>.
 *  Video is detected the same way the rest of the site does it (mimeType first,
 *  filename extension as the fallback) and plays inline, muted and looping —
 *  the write-up panel is prose, not a player, so there are no controls. */
function serializeUpload(node: SlateNode): string {
  const doc = typeof node.value === 'object' && node.value !== null ? node.value : undefined;
  const src = mediaUrl(doc);
  // Depth 0, a deleted media doc, or a broken relation: render nothing rather
  // than an empty frame in the middle of the copy.
  if (!src) return '';

  const mime = typeof doc?.mimeType === 'string' ? doc.mimeType : '';
  const isVideo = /^video\//i.test(mime) || /\.(webm|mp4|m4v|mov)(\?|$)/i.test(src);
  const span = node.fields?.span === 'half' ? 'half' : 'full';
  const caption = (node.fields?.caption ?? '').trim();

  // Reserve the box before the file loads — otherwise the panel reflows under
  // the reader mid-scroll. Images carry width/height from the upload; VIDEO
  // docs do not (Payload never probes them), so a clip gets a 16/9 placeholder
  // that ProjectPage corrects on `loadedmetadata`. Without it a <video> with no
  // intrinsic size lays out at the UA default 300x150 and the panel jumps.
  const w = typeof doc?.width === 'number' ? doc.width : 0;
  const h = typeof doc?.height === 'number' ? doc.height : 0;
  const ratio =
    w > 0 && h > 0
      ? ` style="aspect-ratio:${w} / ${h}"`
      : isVideo
        ? ' style="aspect-ratio:16 / 9"'
        : '';

  const media = isVideo
    ? `<video src="${escapeHtml(src)}"${ratio} autoplay muted loop playsinline preload="metadata"></video>`
    : `<img src="${escapeHtml(src)}"${ratio} alt="${escapeHtml(doc?.alt ?? '')}" loading="lazy" decoding="async">`;

  const cap = caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : '';
  return `<figure class="rt-fig rt-fig--${span}">${media}${cap}</figure>`;
}

function serializeNodes(nodes: SlateNode[]): string {
  return nodes.map(serializeNode).join('');
}

function serializeNode(node: SlateNode): string {
  // A leaf has `text` and no children.
  if (typeof node.text === 'string' && node.children === undefined) {
    return serializeLeaf(node);
  }

  // Void element — its only child is a placeholder space, so serialize it
  // before the children are rendered.
  if (node.type === 'upload') return serializeUpload(node);

  const children = serializeNodes(node.children ?? []);
  const a = alignAttr(node);

  switch (node.type) {
    case 'h1': return `<h1${a}>${children}</h1>`;
    case 'h2': return `<h2${a}>${children}</h2>`;
    case 'h3': return `<h3${a}>${children}</h3>`;
    case 'h4': return `<h4${a}>${children}</h4>`;
    case 'h5': return `<h5${a}>${children}</h5>`;
    case 'h6': return `<h6${a}>${children}</h6>`;
    case 'blockquote': return `<blockquote${a}>${children}</blockquote>`;
    case 'ul': return `<ul>${children}</ul>`;
    case 'ol': return `<ol>${children}</ol>`;
    case 'li': return `<li>${children}</li>`;
    case 'indent': return `<div class="rt-indent">${children}</div>`;
    case 'link': {
      const href = escapeHtml(node.url ?? '#');
      const tab = node.newTab ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${href}"${tab}>${children}</a>`;
    }
    default:
      // Default block = paragraph. Drop empty paragraphs so a blank field
      // renders nothing instead of a stray <p></p>.
      return children.trim() === '' ? '' : `<p${a}>${children}</p>`;
  }
}

/**
 * Inline emphasis for the PLAIN-TEXT fields.
 *
 * `summary` is a textarea, so what an editor types is what the site prints —
 * and six of the forty projects write the tour or album name in *asterisks*,
 * because that is the convention the copy docs use and the write-up field
 * honours it. Only the summary was printing the markers raw.
 *
 * Escaped first, then marked up, so this stays safe to hand to set:html.
 * Bold before italic, or `**x**` gets eaten by the italic rule. The word-
 * boundary guards keep `snake_case` and mid-word asterisks out of it.
 */
export function renderInline(text: unknown): string {
  return escapeHtml(String(text ?? ''))
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/g, '$1<em>$2</em>');
}

/**
 * The same markers removed rather than rendered, for the places that need real
 * text — the <meta description>, where a tag would be nonsense and an asterisk
 * would end up in a search result.
 */
export function plainInline(text: unknown): string {
  return String(text ?? '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1$2')
    .replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/g, '$1$2');
}

/** Render a Payload Slate rich-text value to an HTML string. */
export function renderRichText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return serializeNodes(value as SlateNode[]);
}
