/**
 * Minimal OpenAI-kompatible JSON-Chat-Completions für Topic-Feeds.
 */

/** @param {string | undefined} raw */
export function chatCompletionsUrl(raw) {
  const base = (raw?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
  return `${base}/chat/completions`;
}

/**
 * @param {string} apiKey
 * @param {string | undefined} baseUrl
 * @param {string} model
 * @param {{ role: 'system' | 'user'; content: string }[]} messages
 * @param {number} [temperature]
 */
export async function openaiJsonCompletion(apiKey, baseUrl, model, messages, temperature = 0.35) {
  const upstream = await fetch(chatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature,
      messages,
      response_format: { type: 'json_object' },
    }),
  });
  const rawText = await upstream.text();
  if (!upstream.ok) {
    throw new Error(`KI (${upstream.status}): ${rawText.slice(0, 500)}`);
  }
  const completion = JSON.parse(rawText);
  const content = completion?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Leere Modell-Antwort');
  }
  const parsed = JSON.parse(content);
  return { completion, parsed };
}
