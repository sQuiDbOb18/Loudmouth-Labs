import { useCallback, useState } from 'react';
import InterviewScreen from './InterviewScreen.jsx';
import './styles.css';

export default function App() {
  const [history, setHistory] = useState([]);
  const [interviewKey, setInterviewKey] = useState(0);

  const handleCompleted = useCallback((assessment) => {
    setHistory((current) => current.some((item) => item.recorded_at === assessment.recorded_at)
      ? current
      : [...current, assessment]);
  }, []);

  const startNewInterview = useCallback(() => {
    setInterviewKey((current) => current + 1);
  }, []);

  return <InterviewScreen key={interviewKey} history={history} onCompleted={handleCompleted} onStartNew={startNewInterview} />;
}
