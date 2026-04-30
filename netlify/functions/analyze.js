const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    if (!process.env.CLAUDE_API_KEY)
      return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'CLAUDE_API_KEY not configured' }) };

    const { heroImages } = JSON.parse(event.body || '{}');

    if (!heroImages || !Array.isArray(heroImages) || heroImages.length === 0 || heroImages.length > 3)
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Provide 1–3 hero images as base64 JPEG strings' }) };

    const imageBlocks = heroImages.map(b64 => ({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: b64 },
    }));

    const prompt = `Return ONLY a valid JSON object (no markdown).

Schema:
{"title":"","description":"","category":"","condition":"","priceLow":0,"priceMid":0,"priceHigh":0,"keywords":[]}

Constraints:
- title: ≤80 chars
- description: 2–3 sentences, honest condition notes
- category: Electronics|Clothing|Furniture|Tools|Sports|Toys|Books|Home|Automotive|Collectibles|Other
- condition: new|like_new|good|fair|poor
- priceLow ≤ priceMid ≤ priceHigh, whole-number USD
- keywords: exactly 6 strings`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 420,
        system: 'You are a marketplace listing expert. Return only valid JSON with no markdown formatting, no code fences, no preamble.',
        messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: prompt }] }],
      }),
    });

    const data = await res.json();

    if (!res.ok || data.type === 'error') {
      const msg = data.error?.message || `Claude API error ${res.status}`;
      console.error('Claude API error:', JSON.stringify(data));
      return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: msg }) };
    }

    const raw = data.content?.[0]?.text;
    if (!raw) return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'Empty response from AI' }) };

    // Multi-stage JSON parser: direct → strip fences → regex extract
    let parsed;
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (!match) {
          console.error('Unparseable Claude response:', raw.slice(0, 300));
          return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'AI returned invalid JSON — please retry' }) };
        }
        try { parsed = JSON.parse(match[0]); }
        catch {
          return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'AI returned invalid JSON — please retry' }) };
        }
      }
    }

    // Validate required fields
    const required = ['title', 'description', 'category', 'priceLow', 'priceMid', 'priceHigh', 'keywords'];
    for (const field of required) {
      if (parsed[field] == null)
        return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: `AI response missing field: ${field}` }) };
    }

    // Auto-correct price ordering (sort ascending)
    const prices = [Number(parsed.priceLow), Number(parsed.priceMid), Number(parsed.priceHigh)].sort((a, b) => a - b);
    parsed.priceLow  = Math.max(1, prices[0]);
    parsed.priceMid  = Math.max(1, prices[1]);
    parsed.priceHigh = Math.max(1, prices[2]);

    // Sanitize keywords
    if (!Array.isArray(parsed.keywords)) parsed.keywords = [];
    parsed.keywords = parsed.keywords.slice(0, 6).map(String);

    // Sanitize strings
    parsed.title       = String(parsed.title       || '').slice(0, 100);
    parsed.description = String(parsed.description || '').slice(0, 1000);
    parsed.category    = String(parsed.category    || 'Other');
    parsed.condition   = ['new','like_new','good','fair','poor'].includes(parsed.condition)
      ? parsed.condition : 'good';

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify(parsed) };

  } catch (err) {
    console.error('analyze function error:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message || 'Internal server error' }) };
  }
};
