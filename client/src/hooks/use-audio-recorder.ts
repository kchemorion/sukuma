import { useState, useCallback, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';

export function useAudioRecorder() {
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);

  const initializeAudioContext = useCallback(async (stream: MediaStream) => {
    try {
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Create waveform visualization
      if (!wavesurferRef.current) {
        wavesurferRef.current = WaveSurfer.create({
          container: '#waveform',
          waveColor: 'violet',
          progressColor: 'purple',
          cursorWidth: 1,
          height: 50,
          normalize: true,
          interact: false
        });
      }

      return audioContext;
    } catch (err) {
      console.error('Error initializing audio context:', err);
      setError('Failed to initialize audio processing');
      throw err;
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      // Request audio with quality constraints
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1
        }
      });

      await initializeAudioContext(stream);

      const recorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 128000
      });

      const chunks: BlobPart[] = [];
      
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        setAudioBlob(blob);
        stream.getTracks().forEach(track => track.stop());
        if (wavesurferRef.current) {
          wavesurferRef.current.loadBlob(blob);
        }
      };

      setMediaRecorder(recorder);
      recorder.start(100); // Collect data every 100ms for smoother visualization
      setIsRecording(true);
      setError(null);

      const startTime = Date.now();
      const interval = setInterval(() => {
        setDuration((Date.now() - startTime) / 1000);
        
        // Update audio level for visualization
        if (analyserRef.current) {
          const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
          setAudioLevel(average);
        }
      }, 100);

      recorder.onstop = () => {
        clearInterval(interval);
        const blob = new Blob(chunks, { type: 'audio/webm' });
        setAudioBlob(blob);
        stream.getTracks().forEach(track => track.stop());
      };
    } catch (err) {
      console.error('Error accessing microphone:', err);
      setError(err instanceof Error ? err.message : 'Failed to access microphone');
    }
  }, [initializeAudioContext]);

  const stopRecording = useCallback(() => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      setIsRecording(false);
      if (analyserRef.current) {
        analyserRef.current.disconnect();
      }
    }
  }, [mediaRecorder]);

  const cleanup = useCallback(() => {
    if (wavesurferRef.current) {
      wavesurferRef.current.destroy();
      wavesurferRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    setAudioBlob(null);
    setDuration(0);
    setAudioLevel(0);
    setError(null);
  }, []);

  return {
    isRecording,
    startRecording,
    stopRecording,
    audioBlob,
    duration,
    isUploading,
    setIsUploading,
    audioLevel,
    error,
    cleanup
  };
}
