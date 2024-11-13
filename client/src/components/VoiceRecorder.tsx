import { Button } from '@/components/ui/button';
import { Mic, Square, Loader2 } from 'lucide-react';
import { useAudioRecorder } from '../hooks/use-audio-recorder';
import { useAudioEffects } from '../hooks/use-audio-effects';
import { VoiceEffectSelector } from './VoiceEffectSelector';
import { useToast } from '@/hooks/use-toast';
import { mutate } from 'swr';
import {
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export function VoiceRecorder() {
  const { toast } = useToast();
  const {
    isRecording,
    startRecording,
    stopRecording,
    audioBlob,
    duration,
    isUploading
  } = useAudioRecorder();
  
  const { currentEffect, setCurrentEffect, applyEffect } = useAudioEffects();

  const handleUpload = async () => {
    if (!audioBlob) return;

    try {
      // Convert blob to AudioBuffer for effects processing
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioContext = new AudioContext();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      // Apply selected effect
      const processedBuffer = await applyEffect(audioBuffer);
      
      // Convert back to blob
      const processedBlob = await new Promise<Blob>((resolve) => {
        const channels = processedBuffer.numberOfChannels;
        const length = processedBuffer.length;
        const offlineContext = new OfflineAudioContext(channels, length, processedBuffer.sampleRate);
        const source = offlineContext.createBufferSource();
        source.buffer = processedBuffer;
        source.connect(offlineContext.destination);
        source.start();
        
        offlineContext.startRendering().then((renderedBuffer) => {
          const wavBlob = bufferToWave(renderedBuffer, renderedBuffer.length);
          resolve(wavBlob);
        });
      });

      const formData = new FormData();
      formData.append('audio', processedBlob, 'audio.wav');
      formData.append('duration', duration.toString());

      const response = await fetch('/api/posts', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Upload failed');

      toast({
        title: 'Success',
        description: 'Your voice note has been posted!',
      });

      mutate('/api/posts');
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to upload voice note',
        variant: 'destructive',
      });
    }
  };

  // Helper function to convert AudioBuffer to WAV blob
  function bufferToWave(abuffer: AudioBuffer, len: number) {
    const numOfChan = abuffer.numberOfChannels;
    const length = len * numOfChan * 2 + 44;
    const buffer = new ArrayBuffer(length);
    const view = new DataView(buffer);
    const channels = [];
    let pos = 0;
    let offset = 0;

    // write WAVE header
    setUint32(0x46464952);                         // "RIFF"
    setUint32(length - 8);                         // file length - 8
    setUint32(0x45564157);                         // "WAVE"
    setUint32(0x20746d66);                         // "fmt " chunk
    setUint32(16);                                 // length = 16
    setUint16(1);                                  // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(abuffer.sampleRate);
    setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2);                      // block-align
    setUint16(16);                                 // 16-bit
    setUint32(0x61746164);                         // "data" - chunk
    setUint32(length - pos - 4);                   // chunk length

    // write interleaved data
    for(let i = 0; i < abuffer.numberOfChannels; i++)
      channels.push(abuffer.getChannelData(i));

    while(pos < length) {
      for(let i = 0; i < numOfChan; i++) {             // interleave channels
        let sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; // scale to 16-bit signed int
        view.setInt16(pos, sample, true);          // write 16-bit sample
        pos += 2;
      }
      offset++                                     // next source sample
    }

    // create Blob
    return new Blob([buffer], { type: "audio/wav" });

    function setUint16(data: number) {
      view.setUint16(pos, data, true);
      pos += 2;
    }

    function setUint32(data: number) {
      view.setUint32(pos, data, true);
      pos += 4;
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Record Voice Note</DialogTitle>
        <DialogDescription>
          Record your voice note and add effects before posting
        </DialogDescription>
      </DialogHeader>
      
      <div className="space-y-4 pt-4">
        <VoiceEffectSelector 
          currentEffect={currentEffect}
          onEffectChange={setCurrentEffect}
        />
        
        <div className="flex justify-center">
          <Button
            size="lg"
            variant={isRecording ? 'destructive' : 'default'}
            className="rounded-full w-16 h-16"
            onClick={isRecording ? stopRecording : startRecording}
          >
            {isRecording ? (
              <Square className="h-6 w-6" />
            ) : (
              <Mic className="h-6 w-6" />
            )}
          </Button>
        </div>

        {duration > 0 && (
          <p className="text-center">
            {Math.floor(duration)}s
          </p>
        )}

        {audioBlob && (
          <Button 
            className="w-full" 
            onClick={handleUpload}
            disabled={isUploading}
          >
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              'Post Voice Note'
            )}
          </Button>
        )}
      </div>
    </>
  );
}
