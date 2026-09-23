export const INTERVIEW_TIME_LIMIT_SECONDS = 600;
export const INTERVIEW_TIME_WARNING_RATIO = 0.8;
export const INTERVIEW_TIME_GRACE_PERIOD_SECONDS = 25;

export const INTERVIEW_TIME_BUDGET_PROMPT =
  `You have about ${INTERVIEW_TIME_LIMIT_SECONDS / 60} minutes total for this interview. Budget your time roughly as follows: 2 minutes for background and introduction, 4 minutes for the technical follow up, 3 minutes for the behavioral question, and the remaining time to wrap up and call record_assessment. Stay aware of time. If you are running long, move to your next question sooner rather than skipping the wrap up.`;

export const INTERVIEW_TIME_WARNING_PROMPT =
  'You have about 2 minutes left. Wrap up your current line of questioning and move toward calling record_assessment soon.';

export const INTERVIEW_TIME_EXPIRY_PROMPT =
  'The interview time limit has been reached. Conclude immediately and call record_assessment right now with whatever information you have gathered so far.';
