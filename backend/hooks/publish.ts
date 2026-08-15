// Shared publish notifier — pokes the local publish webhook so a content change
// triggers a site rebuild (same endpoint the Projects collection uses). Kept resilient
// for the newer content types (equipment, services global): a failed poke is logged, not
// thrown, so a CMS save never fails just because the rebuild pipeline hiccups. (Projects
// keeps its own stricter throwing hook.) Flip `strict` on once the pipeline is validated
// for these types if you want save-blocking behaviour.
export async function notifyPublish(
  operation: string,
  doc: { id?: unknown; slug?: string; status?: string },
  strict = false,
): Promise<void> {
  try {
    const res = await fetch('http://127.0.0.1:8788/hook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': process.env.MCP_WEBHOOK_SECRET || '',
      },
      body: JSON.stringify({ operation, doc }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => 'unknown error');
      const msg = `Publish webhook ${res.status}: ${errBody}`;
      if (strict) throw new Error(msg);
      console.warn(`[publish] ${msg}`);
    }
  } catch (err) {
    if (strict) throw err;
    console.warn('[publish] webhook unreachable:', err);
  }
}
