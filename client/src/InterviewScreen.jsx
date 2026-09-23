import { useEffect, useRef } from 'react';
import { useVoiceAgent } from './useVoiceAgent.js';
import { INTERVIEW_TIME_LIMIT_SECONDS } from './interviewConfig.js';

const recommendationMeta = {
  strong_yes: { label: 'Strong Hire', tone: 'strong-positive' },
  yes: { label: 'Hire', tone: 'positive' },
  maybe: { label: 'Borderline', tone: 'neutral' },
  no: { label: 'No Hire', tone: 'negative' },
  strong_no: { label: 'Strong No Hire', tone: 'strong-negative' },
};

function recommendationDetails(value) {
  return recommendationMeta[value] || { label: value || 'Unrated', tone: 'neutral' };
}

export default function InterviewScreen({ history, onCompleted, onStartNew }) {
  const agent = useVoiceAgent();
  const { status, error, messages, partialUser, assessment, elapsedSeconds, timedOut } = agent;
  const active = ['connecting', 'live', 'agent-speaking', 'ending', 'time-limit'].includes(status);
  const reportedAssessmentRef = useRef(null);

  useEffect(() => {
    if (assessment && status === 'ended' && reportedAssessmentRef.current !== assessment.recorded_at) {
      reportedAssessmentRef.current = assessment.recorded_at;
      onCompleted(assessment);
    }
  }, [assessment, onCompleted, status]);

  if (assessment && status === 'ended') return (
    <main className="shell"><section className="card results"><p className="eyebrow">Interview complete</p><h1>Your interview signal</h1><div className="score"><strong>{assessment.score}</strong><span>/ 10</span></div><div className="recommendation"><span className={`recommendation-badge ${recommendationDetails(assessment.recommendation).tone}`}>{recommendationDetails(assessment.recommendation).label}</span></div><ResultList title="Skills demonstrated" items={assessment.skills} /><ResultList title="Notable quotes" items={assessment.notable_quotes} /><ResultList title="Red flags" items={assessment.red_flags} empty="No red flags recorded." /><button className="button secondary" onClick={onStartNew}>Start New Interview <span>→</span></button></section><HistoryList history={history} /></main>
  );

  return <main className="shell"><section className="card"><div className="brand"><span className="brand-mark">LM</span><span>Loudmouth Labs</span></div><p className="eyebrow">Voice screening</p><h1>Tell your story.<br /><em>We’ll listen closely.</em></h1><p className="intro">A short, adaptive conversation for software engineering candidates. Answer naturally—the interviewer will follow your lead.</p>
    {!active && status !== 'ended' && <button className="button" onClick={agent.start}>Start interview <span>→</span></button>}
    {active && <><div className="live-header"><span className={`pulse ${agent.isSpeaking ? 'is-speaking' : ''}`} />{status === 'connecting' ? 'Connecting…' : status === 'agent-speaking' ? 'Interviewer is speaking' : status === 'time-limit' ? 'Wrapping up on time' : 'Listening for your answer'}<InterviewTimer elapsedSeconds={elapsedSeconds} timedOut={timedOut} /></div><div className="transcript" aria-live="polite">{messages.length === 0 && <p className="empty">Your conversation will appear here.</p>}{messages.map((message, index) => <div className="message" key={`${index}-${message.text}`}><span>{message.speaker}</span><p>{message.text}</p></div>)}{partialUser && <div className="message partial"><span>You</span><p>{partialUser}</p></div>}</div><button className="button danger" onClick={agent.end}>End interview</button></>}
    {status === 'ended' && !assessment && <><p className={`notice ${timedOut ? 'timeout-notice' : ''}`}>{timedOut ? 'This interview reached its 10-minute time limit before an assessment was recorded.' : 'The session ended without an assessment.'}</p><button className="button secondary" onClick={onStartNew}>Start New Interview <span>→</span></button></>}
    {error && <p className="error" role="alert">{error}</p>}
  </section><HistoryList history={history} /></main>;
}

function ResultList({ title, items, empty }) { return <div className="result-list"><h2>{title}</h2>{items?.length ? <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="muted">{empty || 'None recorded.'}</p>}</div>; }

function InterviewTimer({ elapsedSeconds, timedOut }) {
  const remainingSeconds = Math.max(0, INTERVIEW_TIME_LIMIT_SECONDS - elapsedSeconds);
  const minutes = Math.floor(remainingSeconds / 60).toString().padStart(2, '0');
  const seconds = (remainingSeconds % 60).toString().padStart(2, '0');
  return <span className={`interview-timer ${timedOut ? 'is-expired' : ''}`} aria-label={`${minutes} minutes ${seconds} seconds remaining`}><small>TIME LEFT</small><strong>{minutes}:{seconds}</strong></span>;
}

function HistoryList({ history }) {
  if (!history.length) return null;
  return <section className="history card"><div className="history-heading"><div><p className="eyebrow">This session</p><h2>Completed interviews</h2></div><span className="history-count">{history.length}</span></div><div className="history-list">{history.map((item, index) => { const recommendation = recommendationDetails(item.recommendation); return <details className="history-item" key={`${item.recorded_at}-${index}`}><summary><span className="history-number">{String(index + 1).padStart(2, '0')}</span><span className="history-main"><strong><span className={`recommendation-badge compact ${recommendation.tone}`}>{recommendation.label}</span></strong><small>{formatTimestamp(item.recorded_at)}</small></span><span className="history-score">{item.score}/10</span></summary><div className="history-details"><ResultList title="Skills" items={item.skills} /><ResultList title="Red flags" items={item.red_flags} empty="None recorded." /><ResultList title="Quotes" items={item.notable_quotes} empty="None recorded." /></div></details>; })}</div></section>;
}

function formatTimestamp(value) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}
