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
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey)
      return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'GEMINI_API_KEY not configured' }) };

    const { heroImages } = JSON.parse(event.body || '{}');
    if (!heroImages || !Array.isArray(heroImages) || !heroImages.length || heroImages.length > 3)
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Provide 1–3 hero images as base64 JPEG strings' }) };

    const parts = [
      ...heroImages.map(b64 => ({
        inlineData: { mimeType: 'image/jpeg', data: b64 },
      })),
      {
        text: `You are a marketplace listing expert. Analyze these product images and return ONLY valid JSON.

Schema: {"title":"","description":"","category":"","condition":"","priceLow":0,"priceMid":0,"priceHigh":0,"keywords":[]}

Rules:
- title: concise, ≤80 chars, describe the item clearly
- description: 2–3 sentences describing the item. Do NOT mention condition, wear, or flaws.
- category: one of Electronics|Clothing|Furniture|Tools|Sports|Toys|Books|Home|Automotive|Collectibles|Other
- condition: one of new|like_new|good|fair|poor
- priceLow ≤ priceMid ≤ priceHigh (whole USD, realistic resale values)
- keywords: exactly 6 search-friendly strings

Return ONLY the JSON object, no markdown, no code fences.`,
      },
    ];

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { maxOutputTokens: 512, temperature: 0.2 },
        }),
      },
    );

    const data = await res.json();

    if (!res.ok || data.error) {
      const msg = data.error?.message || `Gemini API error ${res.status}`;
      console.error('Gemini API error:', JSON.stringify(data));
      return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: msg }) };
    }

    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'Empty AI response' }) };

    // Parse JSON (try direct → strip fences → regex)
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
          console.error('Unparseable response:', raw.slice(0, 300));
          return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'AI returned invalid JSON' }) };
        }
        try { parsed = JSON.parse(match[0]); }
        catch {
          return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'AI returned invalid JSON' }) };
        }
      }
    }

    // Validate
    const required = ['title', 'description', 'category', 'priceLow', 'priceMid', 'priceHigh', 'keywords'];
    for (const f of required) {
      if (parsed[f] == null)
        return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: `Missing field: ${f}` }) };
    }

    // Sanitize
    const prices = [Number(parsed.priceLow), Number(parsed.priceMid), Number(parsed.priceHigh)].sort((a, b) => a - b);
    parsed.priceLow  = Math.max(1, prices[0]);
    parsed.priceMid  = Math.max(1, prices[1]);
    parsed.priceHigh = Math.max(1, prices[2]);
    if (!Array.isArray(parsed.keywords)) parsed.keywords = [];
    parsed.keywords = parsed.keywords.slice(0, 6).map(String);
    parsed.title       = String(parsed.title || '').slice(0, 100);
    parsed.description = String(parsed.description || '').slice(0, 1000);
    parsed.category    = String(parsed.category || 'Other');
    parsed.condition   = ['new', 'like_new', 'good', 'fair', 'poor'].includes(parsed.condition)
      ? parsed.condition : 'good';

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify(parsed) };

  } catch (err) {
    console.error('analyze error:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message || 'Internal error' }) };
  }
};
