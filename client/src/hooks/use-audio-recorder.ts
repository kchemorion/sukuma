import { useState, useCallback } from 'react';

export function useAudioRecorder() {
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        setAudioBlob(blob);
      };

      setMediaRecorder(recorder);
      recorder.start();
      setIsRecording(true);

      const startTime = Date.now();
      const interval = setInterval(() => {
        setDuration((Date.now() - startTime) / 1000);
      }, 100);

      recorder.onstop = () => {
        clearInterval(interval);
        const blob = new Blob(chunks, { type: 'audio/webm' });
        setAudioBlob(blob);
        stream.getTracks().forEach(track => track.stop());
      };
    } catch (err) {
      console.error('Error accessing microphone:', err);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      setIsRecording(false);
    }
  }, [mediaRecorder]);

  return {
    isRecording,
    startRecording,
    stopRecording,
    audioBlob,
    duration,
    isUploading,
    setIsUploading
  };
}
