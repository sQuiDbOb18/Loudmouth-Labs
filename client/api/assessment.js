let latestAssessment = null;

const recommendations = new Set(['strong_yes', 'yes', 'maybe', 'no', 'strong_no']);

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const assessment = req.body;
  const valid = assessment &&
    Array.isArray(assessment.skills) &&
    Array.isArray(assessment.red_flags) &&
    Array.isArray(assessment.notable_quotes) &&
    typeof assessment.score === 'number' &&
    Number.isFinite(assessment.score) && assessment.score >= 1 && assessment.score <= 10 &&
    recommendations.has(assessment.recommendation);

  if (!valid) {
    return res.status(400).json({ error: 'Invalid assessment payload' });
  }

  latestAssessment = { ...assessment, recorded_at: new Date().toISOString() };
  return res.status(201).json({ assessment: latestAssessment });
}
