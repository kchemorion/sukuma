import { Button } from '@/components/ui/button';
import { Mic, Square, Loader2 } from 'lucide-react';
import { useAudioRecorder } from '../hooks/use-audio-recorder';
import { useToast } from '@/hooks/use-toast';
import { mutate } from 'swr';

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

  const handleUpload = async () => {
    if (!audioBlob) return;

    const formData = new FormData();
    formData.append('audio', audioBlob);
    formData.append('duration', duration.toString());

    try {
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

  return (
    <div className="space-y-4">
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
  );
}
