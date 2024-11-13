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
import type { Channel } from 'db/schema';
import useSWR from 'swr';
import { useState, useCallback, useEffect } from 'react';
import * as Tone from 'tone';

// Initialize Tone.js
async function initializeTone() {
  try {
    await Tone.start();
    console.log('Tone.js initialized');
  } catch (error) {
    console.error('Failed to initialize Tone.js:', error);
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
  const { data: channels, isLoading: isLoadingChannels } = useSWR<Channel[]>('/api/channels');
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredChannels, setFilteredChannels] = useState<Channel[]>([]);
  const [isToneInitialized, setIsToneInitialized] = useState(false);

  // Initialize Tone.js on component mount
  useEffect(() => {
    if (!isToneInitialized) {
      initializeTone().then(() => setIsToneInitialized(true));
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
      
      // Apply selected effect only if Tone.js is initialized
      let processedBuffer = audioBuffer;
      if (isToneInitialized && currentEffect !== 'none') {
        console.log('Applying effect:', currentEffect);
        processedBuffer = await applyEffect(audioBuffer);
      }
      
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
          Record your voice note, add effects, and optionally select a channel to post to
        </DialogDescription>
      </DialogHeader>
      
      <div className="space-y-4 pt-4">
        <VoiceEffectSelector 
          currentEffect={currentEffect}
          onEffectChange={setCurrentEffect}
        />
        
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search channels..."
              value={searchQuery}
              onChange={handleSearch}
              className="pl-8"
              aria-label="Search channels"
            />
          </div>
          
          {isLoadingChannels ? (
            <div className="flex items-center justify-center p-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="ml-2 text-sm text-muted-foreground">Loading channels...</span>
            </div>
          ) : (
            <Select
              value={selectedChannel ?? undefined}
              onValueChange={setSelectedChannel}
              disabled={isLoadingChannels}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a channel (optional)" />
              </SelectTrigger>
              <SelectContent>
                {filteredChannels.map((channel) => (
                  <SelectItem
                    key={channel.id}
                    value={channel.id.toString()}
                  >
                    {channel.name}
                  </SelectItem>
                ))}
                {filteredChannels.length === 0 && (
                  <div className="p-2 text-sm text-muted-foreground text-center">
                    No channels found
                  </div>
                )}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="flex justify-center" role="region" aria-label="Voice recording controls">
          <Button
            size="lg"
            variant={isRecording ? 'destructive' : 'default'}
            className="rounded-full w-16 h-16"
            onClick={isRecording ? stopRecording : startRecording}
            aria-label={isRecording ? "Stop Recording" : "Start Recording"}
            aria-pressed={isRecording}
            disabled={!isToneInitialized}
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
            disabled={isUploading || !isToneInitialized}
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
