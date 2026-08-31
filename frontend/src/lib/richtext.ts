// Minimal serializer for Payload's Slate rich-text JSON → HTML string.
//
// Payload's slate editor stores a value as an array of nodes: leaves carry
// `text` plus optional marks (bold/italic/…), elements carry a `type` and
// `children`. The default block (no `type`) is a paragraph. We render the
// handful of node types the write-up uses and fall back to <p> for anything
// unrecognised. Text is escaped — the CMS is trusted, but rendered via set:html.

interface SlateNode {
  text?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  code?: boolean;
  type?: string;
  url?: string;
  newTab?: boolean;
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
  return text;
}

function serializeNodes(nodes: SlateNode[]): string {
  return nodes.map(serializeNode).join('');
}

function serializeNode(node: SlateNode): string {
  // A leaf has `text` and no children.
  if (typeof node.text === 'string' && node.children === undefined) {
    return serializeLeaf(node);
  }

  const children = serializeNodes(node.children ?? []);

  switch (node.type) {
    case 'h1': return `<h1>${children}</h1>`;
    case 'h2': return `<h2>${children}</h2>`;
    case 'h3': return `<h3>${children}</h3>`;
    case 'h4': return `<h4>${children}</h4>`;
    case 'h5': return `<h5>${children}</h5>`;
    case 'h6': return `<h6>${children}</h6>`;
    case 'blockquote': return `<blockquote>${children}</blockquote>`;
    case 'ul': return `<ul>${children}</ul>`;
    case 'ol': return `<ol>${children}</ol>`;
    case 'li': return `<li>${children}</li>`;
    case 'link': {
      const href = escapeHtml(node.url ?? '#');
      const tab = node.newTab ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${href}"${tab}>${children}</a>`;
    }
    default:
      // Default block = paragraph. Drop empty paragraphs so a blank field
      // renders nothing instead of a stray <p></p>.
      return children.trim() === '' ? '' : `<p>${children}</p>`;
  }
}

/** Render a Payload Slate rich-text value to an HTML string. */
export function renderRichText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return serializeNodes(value as SlateNode[]);
}
