import { Button } from '@/components/ui/button';
import { Mic, Square, Loader2 } from 'lucide-react';
import { useAudioRecorder } from '../hooks/use-audio-recorder';
import { useAudioEffects } from '../hooks/use-audio-effects';
import { VoiceEffectSelector } from './VoiceEffectSelector';
import { useToast } from '@/hooks/use-toast';
import { mutate } from 'swr';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { Post } from 'db/schema';
import { useState, useCallback, useEffect } from 'react';
import * as Tone from 'tone';
import WaveSurfer from 'wavesurfer.js';

// Initialize Tone.js with proper error handling
async function initializeTone() {
  try {
    await Tone.start().catch(error => {
      console.error('[Audio] Tone.js start error:', error);
      return false;
    });
    console.log('[Audio] Tone.js initialized successfully');
    return true;
  } catch (error) {
    console.error('[Audio] Failed to initialize Tone.js:', error);
    return false;
  }
}

interface VoiceRecorderProps {
  replyingTo?: Post;
  onSuccess?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VoiceRecorder({ replyingTo, onSuccess, open, onOpenChange }: VoiceRecorderProps) {
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
  const [isToneInitialized, setIsToneInitialized] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [waveform, setWaveform] = useState<WaveSurfer | null>(null);

  // Initialize Tone.js on component mount with proper error handling
  useEffect(() => {
    let mounted = true;

    if (!isToneInitialized && open) {
      const initTone = async () => {
        try {
          const success = await initializeTone().catch(error => {
            console.error('[Audio] Tone.js initialization error:', error);
            return false;
          });
          
          if (!mounted) return;

          setIsToneInitialized(success);
          if (!success) {
            setInitializationError('Failed to initialize audio system. Please try again.');
          }
        } catch (error) {
          console.error('[Audio] Error initializing Tone.js:', error);
          if (mounted) {
            setInitializationError('Audio system initialization failed. Please refresh the page.');
          }
        }
      };

      // Handle promise rejection during initialization
      initTone().catch(error => {
        console.error('[Audio] Unhandled initialization error:', error);
        if (mounted) {
          setInitializationError('Failed to initialize audio system. Please try again.');
        }
      });
    }

    return () => {
      mounted = false;
    };
  }, [isToneInitialized, open]);

  // Handle upload with proper error handling
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
      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.wav');
      formData.append('duration', duration.toString());
      
      if (replyingTo) {
        formData.append('parent_id', replyingTo.id.toString());
      }

      const response = await fetch('/api/posts', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(errorData.message || `Upload failed with status: ${response.status}`);
      }

      const result = await response.json();
      console.log('[Audio] Upload successful:', result);

      toast({
        title: 'Success',
        description: replyingTo ? 'Your reply has been posted!' : 'Your voice note has been posted!',
      });

      mutate('/api/posts');
      if (replyingTo) {
        mutate(`/api/posts/${replyingTo.id}/replies`);
      }
      
      onSuccess?.();
      onOpenChange(false);
    } catch (error) {
      console.error('[Audio] Error in handleUpload:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to upload voice note',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Initialize WaveSurfer for waveform visualization
  useEffect(() => {
    if (!open) return;

    const wavesurferContainer = document.getElementById('waveform');
    if (!wavesurferContainer) return;

    const wavesurfer = WaveSurfer.create({
      container: wavesurferContainer,
      waveColor: '#4f46e5',
      progressColor: '#818cf8',
      cursorWidth: 0,
      barWidth: 2,
      barGap: 1,
      height: 60,
      normalize: true,
    });

    setWaveform(wavesurfer);

    return () => {
      wavesurfer.destroy();
      setWaveform(null);
    };
  }, [open]);

  // Update waveform when audio blob changes
  useEffect(() => {
    if (waveform && audioBlob) {
      waveform.loadBlob(audioBlob);
    }
  }, [waveform, audioBlob]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
      waveform?.destroy();
    };
  }, [cleanup, waveform]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {replyingTo ? 'Reply with Voice Note' : 'Record Voice Note'}
          </DialogTitle>
          <DialogDescription>
            {replyingTo 
              ? `Record your voice reply to ${replyingTo.username}'s post`
              : 'Record your voice note and share it with the community'
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

          <div id="waveform" className="w-full bg-secondary/10 rounded-lg overflow-hidden" />
          
          {isRecording && (
            <div 
              className="h-1 bg-primary transition-all duration-75"
              style={{
                transform: `scaleY(${audioLevel / 255})`,
                transformOrigin: 'bottom'
              }}
            />
          )}

          <div className="flex justify-center space-x-4">
            <Button
              size="lg"
              variant={isRecording ? 'destructive' : 'default'}
              className="rounded-full w-16 h-16"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={!isToneInitialized || !!initializationError}
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
            <p className="text-center text-sm text-muted-foreground">
              Recording duration: {Math.floor(duration)}s
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
                  Processing...
                </>
              ) : (
                replyingTo ? 'Post Reply' : 'Post Voice Note'
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
