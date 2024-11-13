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
  DialogContent,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Channel } from 'db/schema';
import useSWR from 'swr';
import { useState } from 'react';

export function VoiceRecorder() {
  const { toast } = useToast();
  const {
    isRecording,
    startRecording,
    stopRecording,
    audioBlob,
    duration,
    isUploading,
    setIsUploading
  } = useAudioRecorder();
  
  const { currentEffect, setCurrentEffect, applyEffect } = useAudioEffects();
  const { data: channels } = useSWR<Channel[]>('/api/channels');
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);

  const handleUpload = async () => {
    if (!audioBlob) {
      console.error('No audio blob available');
      return;
    }

    setIsUploading(true);

    try {
      console.log('Starting audio processing');
      const arrayBuffer = await audioBlob.arrayBuffer();
      console.log('Audio blob converted to array buffer:', {
        size: arrayBuffer.byteLength,
        type: audioBlob.type
      });

      const audioContext = new AudioContext();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      console.log('Audio decoded:', {
        duration: audioBuffer.duration,
        numberOfChannels: audioBuffer.numberOfChannels,
        sampleRate: audioBuffer.sampleRate
      });
      
      // Apply selected effect
      console.log('Applying effect:', currentEffect);
      const processedBuffer = await applyEffect(audioBuffer);
      
      // Convert back to blob
      console.log('Converting processed buffer to WAV');
      const processedBlob = await new Promise<Blob>((resolve, reject) => {
        try {
          const channels = processedBuffer.numberOfChannels;
          const length = processedBuffer.length;
          const offlineContext = new OfflineAudioContext(channels, length, processedBuffer.sampleRate);
          const source = offlineContext.createBufferSource();
          source.buffer = processedBuffer;
          source.connect(offlineContext.destination);
          source.start();
          
          offlineContext.startRendering().then((renderedBuffer) => {
            const wavBlob = bufferToWave(renderedBuffer, renderedBuffer.length);
            console.log('WAV blob created:', {
              size: wavBlob.size,
              type: wavBlob.type
            });
            resolve(wavBlob);
          }).catch(reject);
        } catch (err) {
          reject(err);
        }
      });

      console.log('Preparing form data for upload');
      const formData = new FormData();
      formData.append('audio', processedBlob, 'audio.wav');
      formData.append('duration', duration.toString());
      if (selectedChannel) {
        formData.append('channel_id', selectedChannel);
      }

      console.log('Uploading processed audio');
      const response = await fetch('/api/posts', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(errorData.message || `Upload failed with status: ${response.status}`);
      }

      const result = await response.json();
      console.log('Upload successful:', result);

      toast({
        title: 'Success',
        description: 'Your voice note has been posted!',
      });

      // Refresh both the main feed and channel feed if posting to a channel
      mutate('/api/posts');
      if (selectedChannel) {
        mutate(`/api/channels/${selectedChannel}/posts`);
      }
    } catch (error) {
      console.error('Error in handleUpload:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to upload voice note',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
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
    <DialogContent>
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
        
        {channels && (
          <Select value={selectedChannel ?? undefined} onValueChange={setSelectedChannel}>
            <SelectTrigger>
              <SelectValue placeholder="Select a channel (optional)" />
            </SelectTrigger>
            <SelectContent>
              {channels.map((channel) => (
                <SelectItem key={channel.id} value={channel.id.toString()}>
                  {channel.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="flex justify-center">
          <Button
            size="lg"
            variant={isRecording ? 'destructive' : 'default'}
            className="rounded-full w-16 h-16"
            onClick={isRecording ? stopRecording : startRecording}
            aria-label={isRecording ? "Stop Recording" : "Start Recording"}
          >
            {isRecording ? (
              <Square className="h-6 w-6" />
            ) : (
              <Mic className="h-6 w-6" />
            )}
          </Button>
        </div>

        {duration > 0 && (
          <p className="text-center" aria-live="polite">
            Recording duration: {Math.floor(duration)}s
          </p>
        )}

        {audioBlob && (
          <Button 
            className="w-full" 
            onClick={handleUpload}
            disabled={isUploading}
            aria-busy={isUploading}
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
    </DialogContent>
  );
}
