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
    if (!process.env.CLAUDE_API_KEY) {
      // Fail open — assume different items so grouping isn't silently broken
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ same: false, error: 'CLAUDE_API_KEY not configured' }) };
    }

    const { image1, image2 } = JSON.parse(event.body || '{}');
    if (!image1 || !image2)
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Both image1 and image2 are required' }) };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 5,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image1 } },
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image2 } },
            { type: 'text', text: 'Are these photos of the same physical object? Answer YES or NO only.' },
          ],
        }],
      }),
    });

    const data = await res.json();
    const answer = data.content?.[0]?.text?.trim().toUpperCase() || 'NO';
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ same: answer.startsWith('Y') }) };

  } catch (err) {
    console.error('sort-check error:', err);
    // Fail open
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ same: false, error: err.message }) };
  }
};
