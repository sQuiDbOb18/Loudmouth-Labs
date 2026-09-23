import { useCallback, useEffect, useRef, useState } from 'react';
import {
  INTERVIEW_TIME_BUDGET_PROMPT,
  INTERVIEW_TIME_EXPIRY_PROMPT,
  INTERVIEW_TIME_GRACE_PERIOD_SECONDS,
  INTERVIEW_TIME_LIMIT_SECONDS,
  INTERVIEW_TIME_WARNING_PROMPT,
  INTERVIEW_TIME_WARNING_RATIO,
} from './interviewConfig.js';
import { apiUrl } from './api.js';

const SYSTEM_PROMPT = `You are conducting a first-round screening interview for a software engineering role. Your job:

1. Ask one question at a time. Wait for the full answer before responding.
2. Start broad (background, recent experience), then go deeper based on what the candidate actually says — if they mention a specific project or technology, ask a genuine follow-up about it rather than moving to a generic next question.
3. Cover in total: background/experience, a technical topic relevant to what they mentioned, and one behavioral/collaboration question. Aim for 5-8 exchanges total.
4. Keep your own responses short and conversational — this is a spoken conversation, not a written one. No bullet points, no long monologues.
5. When you have enough signal to assess the candidate (or after covering the topics above), thank them for their time, let them know the interview is wrapping up, and then call the record_assessment tool with your evaluation. Do not narrate that you're "calling a tool" — just naturally conclude the conversation and invoke it.`;

const TOOL = {
  type: 'function',
  name: 'record_assessment',
  description: 'Record the structured outcome of the interview once it has concluded.',
  parameters: {
    type: 'object',
    properties: {
      skills: { type: 'array', items: { type: 'string' }, description: 'Key skills or technologies the candidate demonstrated or mentioned.' },
      red_flags: { type: 'array', items: { type: 'string' }, description: 'Any concerns, inconsistencies, or gaps noticed. Empty array if none.' },
      notable_quotes: { type: 'array', items: { type: 'string' }, description: 'Short, specific things the candidate said that stood out, positive or negative.' },
      score: { type: 'number', description: 'Overall assessment score from 1-10.' },
      recommendation: { type: 'string', description: 'One of: strong_yes, yes, maybe, no, strong_no' },
    },
    required: ['skills', 'red_flags', 'notable_quotes', 'score', 'recommendation'],
  },
};

const sessionConfig = {
  system_prompt: `${SYSTEM_PROMPT}\n\n${INTERVIEW_TIME_BUDGET_PROMPT}`,
  greeting: "Hi! Thanks for joining. I'll be asking you a few questions about your background and experience — just answer naturally, and I'll follow up based on what you tell me. Ready when you are.",
  input: {
    format: { encoding: 'audio/pcm' },
    turn_detection: { vad_threshold: 0.5, min_silence: 1000, max_silence: 3000, interrupt_response: true },
  },
  output: { voice: 'anna', format: { encoding: 'audio/pcm' } },
  tools: [TOOL],
};

const DEBUG_AUDIO = import.meta.env.DEV;

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  return btoa(binary);
}

function downsampleToPcm16(samples, inputRate, outputRate) {
  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.round(samples.length / ratio));
  const pcm = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), samples.length);
    let total = 0;
    for (let j = start; j < Math.max(start + 1, end); j += 1) total += samples[Math.min(j, samples.length - 1)] || 0;
    const value = Math.max(-1, Math.min(1, total / Math.max(1, end - start)));
    pcm[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  const encoded = bytesToBase64(new Uint8Array(pcm.buffer));
  if (DEBUG_AUDIO) console.debug('[audio] resampled PCM16 chunk', {
    inputRate,
    inputSamples: samples.length,
    outputSamples: pcm.length,
    bytes: pcm.byteLength,
  });
  return encoded;
}

export function useVoiceAgent() {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [messages, setMessages] = useState([]);
  const [partialUser, setPartialUser] = useState('');
  const [assessment, setAssessment] = useState(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const inputContextRef = useRef(null);
  const inputStreamRef = useRef(null);
  const inputSourceRef = useRef(null);
  const workletNodeRef = useRef(null);
  const inputSamplesRef = useRef([]);
  const nextPlaybackTimeRef = useRef(0);
  const outputSourcesRef = useRef(new Set());
  const sessionIdRef = useRef(null);
  const startedAtRef = useRef(0);
  const pendingToolRef = useRef(null);
  const replyDoneRef = useRef(false);
  const reconnectTimerRef = useRef(null);
  const intentionalCloseRef = useRef(false);
  const sessionReadyRef = useRef(false);
  const audioStatsRef = useRef({ sent: 0, bytes: 0, dropped: 0 });
  const timerIntervalRef = useRef(null);
  const graceTimerRef = useRef(null);
  const sessionReadyAtRef = useRef(0);
  const timerStartedRef = useRef(false);
  const warningSentRef = useRef(false);
  const hardStopSentRef = useRef(false);
  const toolCalledRef = useRef(false);
  const lastSessionEndReasonRef = useRef(null);

  const flushAudio = useCallback(() => {
    outputSourcesRef.current.forEach((source) => { try { source.stop(); } catch {} });
    outputSourcesRef.current.clear();
    nextPlaybackTimeRef.current = 0;
  }, []);

  const clearInterviewTimers = useCallback(() => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
    timerIntervalRef.current = null;
    graceTimerRef.current = null;
    timerStartedRef.current = false;
    sessionReadyAtRef.current = 0;
  }, []);

  const cleanupAudio = useCallback(() => {
    clearInterviewTimers();
    flushAudio();
    workletNodeRef.current?.disconnect();
    inputSourceRef.current?.disconnect();
    inputStreamRef.current?.getTracks().forEach((track) => track.stop());
    inputContextRef.current?.close();
    audioContextRef.current?.close();
    workletNodeRef.current = null;
    inputSourceRef.current = null;
    inputStreamRef.current = null;
    inputContextRef.current = null;
    audioContextRef.current = null;
    inputSamplesRef.current = [];
    sessionReadyRef.current = false;
  }, [clearInterviewTimers, flushAudio]);

  const send = useCallback((payload) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(payload));
  }, []);

  const sendSessionEnd = useCallback((reason) => {
    lastSessionEndReasonRef.current = reason;
    console.info('[interview] session.end sent', { reason });
    send({ type: 'session.end' });
  }, [send]);

  const sendInputAudio = useCallback((audio) => {
    const socketOpen = wsRef.current?.readyState === WebSocket.OPEN;
    if (!socketOpen || !sessionReadyRef.current) {
      audioStatsRef.current.dropped += 1;
      if (DEBUG_AUDIO && audioStatsRef.current.dropped === 1) {
        console.warn('[audio] dropped input chunk before WebSocket/session.ready', {
          socketOpen,
          sessionReady: sessionReadyRef.current,
        });
      }
      return;
    }
    wsRef.current.send(JSON.stringify({ type: 'input.audio', audio }));
    audioStatsRef.current.sent += 1;
    audioStatsRef.current.bytes += Math.floor(audio.length * 3 / 4);
    if (DEBUG_AUDIO && audioStatsRef.current.sent % 20 === 0) {
      console.debug('[audio] input.audio sent', audioStatsRef.current);
    }
  }, []);

  const sendSystemPromptUpdate = useCallback((additionalPrompt) => {
    send({
      type: 'session.update',
      session: {
        system_prompt: `${SYSTEM_PROMPT}\n\n${INTERVIEW_TIME_BUDGET_PROMPT}\n\n${additionalPrompt}`,
      },
    });
  }, [send]);

  const startInterviewTimer = useCallback(() => {
    if (timerStartedRef.current) return;
    timerStartedRef.current = true;
    sessionReadyAtRef.current = Date.now();
    warningSentRef.current = false;
    hardStopSentRef.current = false;
    toolCalledRef.current = false;
    setElapsedSeconds(0);
    setTimedOut(false);

    timerIntervalRef.current = setInterval(() => {
      const elapsed = Math.min(
        INTERVIEW_TIME_LIMIT_SECONDS,
        Math.floor((Date.now() - sessionReadyAtRef.current) / 1000),
      );
      setElapsedSeconds(elapsed);

      if (!warningSentRef.current && elapsed >= INTERVIEW_TIME_LIMIT_SECONDS * INTERVIEW_TIME_WARNING_RATIO) {
        warningSentRef.current = true;
        sendSystemPromptUpdate(INTERVIEW_TIME_WARNING_PROMPT);
        if (DEBUG_AUDIO) console.info('[interview] time warning sent', { elapsed });
      }

      if (!hardStopSentRef.current && elapsed >= INTERVIEW_TIME_LIMIT_SECONDS) {
        hardStopSentRef.current = true;
        setTimedOut(true);
        setStatus('time-limit');
        sendSystemPromptUpdate(INTERVIEW_TIME_EXPIRY_PROMPT);
        if (DEBUG_AUDIO) console.warn('[interview] time limit reached; grace period started', {
          graceSeconds: INTERVIEW_TIME_GRACE_PERIOD_SECONDS,
        });
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
        graceTimerRef.current = setTimeout(() => {
          if (toolCalledRef.current) return;
          intentionalCloseRef.current = true;
          setStatus('ending');
          sendSessionEnd('hard time limit grace period expired without record_assessment');
          if (DEBUG_AUDIO) console.warn('[interview] assessment grace period expired; session.end sent');
        }, INTERVIEW_TIME_GRACE_PERIOD_SECONDS * 1000);
      }
    }, 1000);
  }, [send, sendSystemPromptUpdate]);

  const recordAssessment = useCallback(async (call) => {
    console.info('[interview] record_assessment called by agent', {
      callId: call.call_id,
      elapsedSeconds: sessionReadyAtRef.current ? Math.floor((Date.now() - sessionReadyAtRef.current) / 1000) : null,
    });
    let parsed;
    try { parsed = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments; } catch { throw new Error('The assessment returned invalid JSON.'); }
    const response = await fetch(apiUrl('/api/assessment'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Could not save the assessment.');
    toolCalledRef.current = true;
    if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
    graceTimerRef.current = null;
    setAssessment(body.assessment);
    pendingToolRef.current = { callId: call.call_id, parsed };
    if (replyDoneRef.current) {
      send({ type: 'tool.result', call_id: call.call_id, result: { status: 'recorded' } });
      pendingToolRef.current = null;
      sendSessionEnd('normal completion after record_assessment');
    }
  }, [send, sendSessionEnd]);

  const handleMessage = useCallback(async (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    switch (message.type) {
      case 'session.ready':
        sessionIdRef.current = message.session_id;
        sessionReadyRef.current = true;
        startInterviewTimer();
        if (DEBUG_AUDIO) console.info('[audio] session.ready; mic chunks may now be sent', { sessionId: message.session_id });
        setStatus('live');
        break;
      case 'session.error':
        console.error('[interview] server session.error', {
          code: message.code,
          message: message.message,
          param: message.param,
        });
        setError(message.message || `AssemblyAI session error: ${message.code || 'unknown'}`);
        break;
      case 'input.speech.started': setIsSpeaking(true); break;
      case 'input.speech.stopped': setIsSpeaking(false); break;
      case 'transcript.user.delta': setPartialUser(message.text || message.transcript || ''); break;
      case 'transcript.user':
        if (message.text || message.transcript) setMessages((current) => [...current, { speaker: 'You', text: message.text || message.transcript }]);
        setPartialUser('');
        break;
      case 'transcript.agent':
        if (message.text || message.transcript) setMessages((current) => [...current, { speaker: 'Interviewer', text: message.text || message.transcript }]);
        break;
      case 'reply.started':
        replyDoneRef.current = false;
        setStatus('agent-speaking');
        break;
      case 'reply.audio': {
        const context = audioContextRef.current;
        if (!context || !message.data) break;
        if (context.state === 'suspended') await context.resume();
        const binary = atob(message.data);
        const pcm = new Int16Array(binary.length / 2);
        for (let i = 0; i < pcm.length; i += 1) pcm[i] = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
        const buffer = context.createBuffer(1, pcm.length, 24000);
        const channel = buffer.getChannelData(0);
        for (let i = 0; i < pcm.length; i += 1) channel[i] = pcm[i] / 0x8000;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        const start = Math.max(context.currentTime + 0.02, nextPlaybackTimeRef.current);
        nextPlaybackTimeRef.current = start + buffer.duration;
        outputSourcesRef.current.add(source);
        source.onended = () => outputSourcesRef.current.delete(source);
        source.start(start);
        break;
      }
      case 'reply.done':
        replyDoneRef.current = true;
        console.info('[interview] reply.done received', { status: message.status, replyId: message.reply_id });
        if (message.status === 'interrupted') flushAudio();
        if (pendingToolRef.current) {
          send({ type: 'tool.result', call_id: pendingToolRef.current.callId, result: { status: 'recorded' } });
          pendingToolRef.current = null;
          sendSessionEnd('normal completion after record_assessment');
        }
        break;
      case 'tool.call':
        if (message.name === 'record_assessment') {
          try { await recordAssessment(message); } catch (toolError) { setError(toolError.message); }
        }
        break;
      case 'session.ended':
        console.info('[interview] session.ended received', {
          trigger: lastSessionEndReasonRef.current || 'server initiated or unknown',
          sessionDurationSeconds: message.session_duration_seconds,
          audioDurationSeconds: message.audio_duration_seconds,
          timestamp: message.timestamp,
        });
        cleanupAudio();
        setStatus('ended');
        break;
      default: break;
    }
  }, [cleanupAudio, flushAudio, recordAssessment, send, sendSessionEnd, startInterviewTimer]);

  const connect = useCallback(async (resume = false) => {
    setStatus('connecting'); setError(''); intentionalCloseRef.current = false;
    sessionReadyRef.current = false;
    const tokenResponse = await fetch(apiUrl('/api/aai-token'));
    const tokenBody = await tokenResponse.json();
    if (!tokenResponse.ok) throw new Error(tokenBody.error || 'Could not get an AssemblyAI token.');
    if (DEBUG_AUDIO) console.info('[audio] fresh AssemblyAI token fetched for new WebSocket');
    const ws = new WebSocket(`wss://agents.assemblyai.com/v1/ws?token=${encodeURIComponent(tokenBody.token)}`);
    wsRef.current = ws;
    ws.onopen = () => {
      if (resume && sessionIdRef.current) send({ type: 'session.resume', session_id: sessionIdRef.current });
      else send({ type: 'session.update', session: sessionConfig });
    };
    ws.onmessage = handleMessage;
    ws.onerror = (errorEvent) => {
      console.error('[interview] WebSocket client error', errorEvent);
      setError('The voice connection encountered an error.');
    };
    ws.onclose = (closeEvent) => {
      wsRef.current = null;
      console.warn('[interview] WebSocket closed', {
        code: closeEvent.code,
        reason: closeEvent.reason || '(no reason supplied)',
        wasClean: closeEvent.wasClean,
        lastSessionEndReason: lastSessionEndReasonRef.current,
      });
      if (intentionalCloseRef.current || closeEvent.code === 1000 || closeEvent.code === 1001) return;
      if (closeEvent.code === 1008) { setError('AssemblyAI rejected the session token. Please try again.'); setStatus('error'); return; }
      if (closeEvent.code === 3005) { setError('The interview was cancelled by the voice service.'); setStatus('error'); return; }
      if (Date.now() - startedAtRef.current < 30000 && sessionIdRef.current) reconnectTimerRef.current = setTimeout(() => connect(true).catch((e) => { setError(e.message); setStatus('error'); }), 250);
      else { setError('The voice connection closed unexpectedly.'); setStatus('error'); }
    };
  }, [handleMessage, send, sendSessionEnd]);

  const start = useCallback(async () => {
    try {
      intentionalCloseRef.current = true;
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
      cleanupAudio();
      replyDoneRef.current = false;
      pendingToolRef.current = null;
      lastSessionEndReasonRef.current = null;
      setMessages([]); setAssessment(null); setPartialUser(''); setElapsedSeconds(0); setTimedOut(false); startedAtRef.current = Date.now();
      const inputContext = new AudioContext();
      const outputContext = new AudioContext();
      await inputContext.resume();
      await outputContext.resume();
      if (DEBUG_AUDIO) console.info('[audio] AudioContexts ready', {
        inputState: inputContext.state,
        outputState: outputContext.state,
        inputSampleRate: inputContext.sampleRate,
      });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      const tracks = stream.getAudioTracks();
      if (DEBUG_AUDIO) console.info('[audio] microphone stream granted', tracks.map((track) => ({ label: track.label, readyState: track.readyState, enabled: track.enabled })));
      if (!tracks.length || tracks.some((track) => track.readyState !== 'live')) throw new Error('Microphone permission was granted, but no live audio track is available.');
      const workletDebugLog = DEBUG_AUDIO ? "console.debug('[audio] AudioWorklet is receiving samples', { samples: samples.length, sampleRate });" : '';
      const workletCode = `class MicProcessor extends AudioWorkletProcessor { constructor() { super(); this.logged = false; } process(inputs) { const samples = inputs[0]?.[0]; if (samples?.length) { if (!this.logged) { ${workletDebugLog} this.logged = true; } this.port.postMessage(samples); } return true; } } registerProcessor('mic-processor', MicProcessor);`;
      const workletUrl = URL.createObjectURL(new Blob([workletCode], { type: 'application/javascript' }));
      await inputContext.audioWorklet.addModule(workletUrl); URL.revokeObjectURL(workletUrl);
      const source = inputContext.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(inputContext, 'mic-processor');
      node.port.onmessage = ({ data }) => {
        inputSamplesRef.current.push(...data);
        const targetSamples = Math.round(inputContext.sampleRate * 0.05);
        while (inputSamplesRef.current.length >= targetSamples) {
          const chunk = inputSamplesRef.current.splice(0, targetSamples);
          sendInputAudio(downsampleToPcm16(chunk, inputContext.sampleRate, 24000));
        }
      };
      source.connect(node); node.connect(inputContext.destination);
      if (DEBUG_AUDIO) console.info('[audio] AudioWorklet graph connected', { sourceRate: inputContext.sampleRate });
      inputContextRef.current = inputContext; audioContextRef.current = outputContext; inputStreamRef.current = stream; inputSourceRef.current = source; workletNodeRef.current = node;
      await connect(false);
    } catch (startError) { cleanupAudio(); setError(startError.message || 'Could not start the microphone.'); setStatus('error'); }
  }, [cleanupAudio, connect, sendInputAudio, sendSessionEnd]);

  const end = useCallback(() => {
    intentionalCloseRef.current = true;
    sendSessionEnd('candidate clicked End interview');
    setStatus('ending');
  }, [sendSessionEnd]);
  useEffect(() => () => { clearTimeout(reconnectTimerRef.current); intentionalCloseRef.current = true; wsRef.current?.close(); cleanupAudio(); }, [cleanupAudio]);

  return {
    status,
    error,
    messages,
    partialUser,
    assessment,
    isSpeaking,
    elapsedSeconds,
    timedOut,
    start,
    end,
  };
}
