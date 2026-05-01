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
    if (!apiKey) {
      // Fail open — assume different items
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ same: false, error: 'GEMINI_API_KEY not configured' }) };
    }

    const { image1, image2 } = JSON.parse(event.body || '{}');
    if (!image1 || !image2)
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Both image1 and image2 required' }) };

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType: 'image/jpeg', data: image1 } },
              { inlineData: { mimeType: 'image/jpeg', data: image2 } },
              { text: 'Are these photos of the same physical object? Answer YES or NO only.' },
            ],
          }],
          generationConfig: { maxOutputTokens: 5, temperature: 0 },
        }),
      },
    );

    const data = await res.json();
    const answer = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase() || 'NO';
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ same: answer.startsWith('Y') }) };

  } catch (err) {
    console.error('sort-check error:', err);
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ same: false, error: err.message }) };
  }
};
