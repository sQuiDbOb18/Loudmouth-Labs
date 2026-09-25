const TOKEN_URL = 'https://agents.assemblyai.com/v1/token?expires_in_seconds=300&max_session_duration_seconds=8640';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY is not configured' });
  }

  try {
    const response = await fetch(TOKEN_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || typeof body.token !== 'string') {
      console.error('AssemblyAI token request failed:', response.status, body);
      return res.status(response.ok ? 502 : response.status).json({
        error: body.error || 'Unable to mint AssemblyAI token',
      });
    }
    return res.status(200).json({ token: body.token });
  } catch (error) {
    console.error('AssemblyAI token request error:', error);
    return res.status(502).json({ error: 'Unable to reach AssemblyAI' });
  }
}
