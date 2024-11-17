import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Mic, Square, Loader2, Search } from 'lucide-react';
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
import type { Channel, Post } from 'db/schema';
import useSWR from 'swr';
import { useState, useCallback, useEffect } from 'react';
import * as Tone from 'tone';
import WaveSurfer from 'wavesurfer.js';

// Initialize Tone.js with proper error handling
async function initializeTone() {
  try {
    await Tone.start();
    console.log('Tone.js initialized successfully');
    return true;
  } catch (error) {
    console.error('Failed to initialize Tone.js:', error);
    return false;
  }
}

// Simple fuzzy search implementation
function fuzzySearch(items: Channel[], query: string): Channel[] {
  const lowercaseQuery = query.toLowerCase();
  return items.filter(item => {
    const lowercaseName = item.name.toLowerCase();
    const lowercaseDesc = item.description.toLowerCase();
    return lowercaseName.includes(lowercaseQuery) || 
           lowercaseDesc.includes(lowercaseQuery);
  });
}

interface VoiceRecorderProps {
  replyingTo?: Post;
  onSuccess?: () => void;
}

export function VoiceRecorder({ replyingTo, onSuccess }: VoiceRecorderProps) {
  const { toast } = useToast();
  const {
    isRecording,
    startRecording,
    stopRecording,
    audioBlob,
    duration,
    isUploading,
    setIsUploading,
    audioLevel,
    error: recordingError,
    cleanup
  } = useAudioRecorder();
  
  const { currentEffect, setCurrentEffect, applyEffect } = useAudioEffects();
  const { data: channels, isLoading: isLoadingChannels } = useSWR<Channel[]>('/api/channels');
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredChannels, setFilteredChannels] = useState<Channel[]>([]);
  const [isToneInitialized, setIsToneInitialized] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(null);

  // Initialize Tone.js on component mount with proper error handling
  useEffect(() => {
    if (!isToneInitialized) {
      const initTone = async () => {
        try {
          const success = await initializeTone();
          setIsToneInitialized(success);
          if (!success) {
            setInitializationError('Failed to initialize audio system. Please try again.');
          }
        } catch (error) {
          console.error('Error initializing Tone.js:', error);
          setInitializationError('Audio system initialization failed. Please refresh the page.');
        }
      };
      initTone();
    }
  }, [isToneInitialized]);

  // Update filtered channels when search query changes or channels data updates
  useEffect(() => {
    if (channels) {
      setFilteredChannels(searchQuery ? fuzzySearch(channels, searchQuery) : channels);
    }
  }, [searchQuery, channels]);

  const handleSearch = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  }, []);

  const handleUpload = async () => {
    if (!audioBlob) {
      toast({
        title: 'Error',
        description: 'No audio recording found. Please record something first.',
        variant: 'destructive',
      });
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
      
      let processedBuffer = audioBuffer;
      if (isToneInitialized && currentEffect !== 'none') {
        console.log('Applying effect:', currentEffect);
        processedBuffer = await applyEffect(audioBuffer);
      }
      
      const processedBlob = await new Promise<Blob>((resolve, reject) => {
        try {
          const channels = processedBuffer.numberOfChannels;
          const length = processedBuffer.length;
          const offlineContext = new OfflineAudioContext(
            channels,
            length,
            processedBuffer.sampleRate
          );
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
      if (replyingTo) {
        formData.append('reply_to', replyingTo.id.toString());
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
        description: replyingTo ? 'Your reply has been posted!' : 'Your voice note has been posted!',
      });

      // Refresh the relevant feeds
      mutate('/api/posts');
      if (selectedChannel) {
        mutate(`/api/channels/${selectedChannel}/posts`);
      }
      if (replyingTo) {
        mutate(`/api/posts/${replyingTo.id}/replies`);
      }
      
      onSuccess?.();
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

  // Initialize WaveSurfer for waveform visualization
  useEffect(() => {
    const wavesurfer = WaveSurfer.create({
      container: '#waveform',
      waveColor: '#ccc',
      progressColor: '#333',
      barWidth: 2,
      barHeight: 1,
      cursorWidth: 0,
      cursorColor: 'transparent',
      height: 50,
      responsive: true,
      backend: 'MediaElement'
    });

    // Update the waveform when a new audioBlob is available
    if (audioBlob) {
      wavesurfer.loadBlob(audioBlob);
    }

    // Cleanup WaveSurfer instance on component unmount
    return () => {
      wavesurfer.destroy();
    };
  }, [audioBlob]);

  // Cleanup the audio recorder on component unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>
          {replyingTo ? 'Reply with Voice Note' : 'Record Voice Note'}
        </DialogTitle>
        <DialogDescription>
          {replyingTo 
            ? `Record your voice reply to ${replyingTo.username}'s post`
            : 'Record your voice note with enhanced audio quality'
          }
        </DialogDescription>
      </DialogHeader>
      
      <div className="space-y-4 pt-4">
        {recordingError && (
          <div className="text-sm text-destructive text-center">
            {recordingError}
          </div>
        )}

        {initializationError && (
          <div className="text-sm text-destructive text-center">
            {initializationError}
          </div>
        )}

        <div className="relative">
          {/* Audio waveform visualization */}
          <div id="waveform" className="w-full h-[50px] bg-secondary rounded-lg overflow-hidden" />
          
          {/* Live audio level visualization during recording */}
          {isRecording && (
            <div 
              className="absolute bottom-0 left-0 w-full h-1 bg-primary transition-transform"
              style={{
                transform: `scaleY(${audioLevel / 255})`,
                transformOrigin: 'bottom'
              }}
            />
          )}
        </div>

        <div className="flex justify-center space-x-4" role="region" aria-label="Voice recording controls">
          <Button
            size="lg"
            variant={isRecording ? 'destructive' : 'default'}
            className="rounded-full w-16 h-16"
            onClick={isRecording ? stopRecording : startRecording}
            aria-label={isRecording ? "Stop Recording" : "Start Recording"}
            aria-pressed={isRecording}
            disabled={!isToneInitialized || !!initializationError}
          >
            {isRecording ? (
              <Square className="h-6 w-6" />
            ) : (
              <Mic className="h-6 w-6" />
            )}
          </Button>
        </div>

        {duration > 0 && (
          <p className="text-center" aria-live="polite" role="status">
            Recording duration: {Math.floor(duration)}s
          </p>
        )}

        {audioBlob && (
          <Button 
            className="w-full" 
            onClick={handleUpload}
            disabled={isUploading || !isToneInitialized || !!initializationError}
            aria-busy={isUploading}
          >
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing and Uploading...
              </>
            ) : (
              replyingTo ? 'Post Reply' : 'Post Voice Note'
            )}
          </Button>
        )}
      </div>
    </DialogContent>
  );
}