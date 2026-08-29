'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechRecognitionHook {
  isSupported: boolean;
  isRecording: boolean;
  transcript: string;
  interimText: string;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  reset: () => void;
  error: string | null;
}

function joinText(prev: string, next: string): string {
  if (!prev) return next;
  if (!next) return prev;
  const pEnd = prev.charCodeAt(prev.length - 1);
  const nStart = next.charCodeAt(0);
  const isSpace = (c: number) => c === 32 || c === 10 || c === 13 || c === 9;
  const isPunct = (c: number) => (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126);
  if (isSpace(pEnd) || isSpace(nStart) || isPunct(pEnd) || isPunct(nStart)) return prev + next;
  return prev + ' ' + next;
}

export function useSpeechRecognition(language = 'pt-PT'): SpeechRecognitionHook {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setIsSupported(!!SR);
  }, []);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
        recognitionRef.current = null;
      }
    };
  }, []);

  const start = useCallback(() => {
    setError(null);
    setInterimText('');
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setError('Speech recognition is not supported in this browser.');
      return;
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }

    const recognition = new SR();
    recognition.lang = language;
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      let final = '';
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      if (final) {
        setTranscript((prev) => joinText(prev, final));
      }
      setInterimText(interim);
    };

    recognition.onerror = (event: any) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setError(`Speech error: ${event.error}`);
      }
      setIsRecording(false);
      setInterimText('');
    };

    recognition.onend = () => {
      setIsRecording(false);
      setInterimText('');
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  }, [language]);

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsRecording(false);
    setInterimText('');
  }, []);

  const toggle = useCallback(() => {
    if (isRecording) stop();
    else start();
  }, [isRecording, start, stop]);

  const reset = useCallback(() => {
    setTranscript('');
    setInterimText('');
    setError(null);
  }, []);

  return { isSupported, isRecording, transcript, interimText, start, stop, toggle, reset, error };
}
