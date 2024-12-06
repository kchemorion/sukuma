import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { VoicePost } from '@/components/VoicePost';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import { useUser } from '../hooks/use-user';
import useSWR from 'swr';
import type { Post } from 'db/schema';
import { Layout } from '@/components/Layout';
import { LoadingState } from '@/components/LoadingState';
import { EmptyState } from '@/components/EmptyState';

export function Home() {
  const { user } = useUser();
  const { data: posts, error } = useSWR<Post[]>('/api/posts');
  const [currentlyPlaying, setCurrentlyPlaying] = useState<number | null>(null);
  const audioRefs = useRef<Record<number, HTMLAudioElement>>({});

  useEffect(() => {
    if (currentlyPlaying !== null && posts) {
      const currentAudio = audioRefs.current[currentlyPlaying];
      if (currentAudio) {
        currentAudio.play();
        currentAudio.onended = () => {
          const nextIndex = posts.findIndex(p => p.id === currentlyPlaying) + 1;
          if (nextIndex < posts.length) {
            setCurrentlyPlaying(posts[nextIndex].id);
          } else {
            setCurrentlyPlaying(null);
          }
        };
      }
    }
  }, [currentlyPlaying, posts]);

  if (error) return (
    <Layout>
      <div className="max-w-2xl mx-auto p-4">
        <EmptyState 
          title="Error Loading Posts"
          description="There was a problem loading the voice posts. Please try again later."
        />
      </div>
    </Layout>
  );

  if (!posts) return (
    <Layout>
      <div className="max-w-2xl mx-auto p-4">
        <LoadingState />
      </div>
    </Layout>
  );

  return (
    <Layout>
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {user && (
          <Dialog>
            <DialogTrigger asChild>
              <Button className="fixed bottom-4 right-4 rounded-full w-12 h-12 p-0">
                <Plus />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <VoiceRecorder />
            </DialogContent>
          </Dialog>
        )}

        <div className="space-y-4">
          {posts.length > 0 ? (
            posts.map((post) => (
              <Card key={post.id} className="p-4">
                <VoicePost
                  post={post}
                  isPlaying={currentlyPlaying === post.id}
                  onPlay={() => setCurrentlyPlaying(post.id)}
                  onPause={() => setCurrentlyPlaying(null)}
                  ref={(el) => {
                    if (el) audioRefs.current[post.id] = el;
                  }}
                />
              </Card>
            ))
          ) : (
            <EmptyState 
              title="No Voice Posts Yet"
              description="Be the first one to share your voice with the community!"
            />
          )}
        </div>
      </div>
    </Layout>
  );
}
