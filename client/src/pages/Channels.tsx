import { useState } from 'react';
import { Layout } from '@/components/Layout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useUser } from '../hooks/use-user';
import { VoicePost } from '@/components/VoicePost';
import useSWR, { mutate } from 'swr';
import type { Channel, Post } from 'db/schema';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from '@/hooks/use-toast';
import { Plus, Loader2 } from 'lucide-react';

export function Channels() {
  const { user } = useUser();
  const { data: channels, error: channelsError, isLoading: isChannelsLoading } = useSWR<Channel[]>('/api/channels');
  const [selectedChannel, setSelectedChannel] = useState<number | null>(null);
  const { data: channelPosts, error: postsError, isLoading: isPostsLoading } = useSWR<Post[]>(
    selectedChannel ? `/api/channels/${selectedChannel}/posts` : null
  );
  const { toast } = useToast();
  const [isCreating, setIsCreating] = useState(false);

  const createChannel = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsCreating(true);
    const formData = new FormData(event.currentTarget);
    const name = formData.get('name') as string;
    const description = formData.get('description') as string;

    try {
      const response = await fetch('/api/channels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, description }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create channel');
      }

      toast({
        title: 'Success',
        description: 'Channel created successfully',
      });

      mutate('/api/channels');
      setIsCreating(false);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create channel',
        variant: 'destructive',
      });
      setIsCreating(false);
    }
  };

  if (channelsError) {
    return (
      <Layout>
        <div className="max-w-6xl mx-auto p-4">
          <div className="text-center text-destructive">
            Error loading channels: {channelsError.message}
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-6xl mx-auto p-4">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Voice Channels</h1>
          {user && (
            <Dialog>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  New Channel
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Channel</DialogTitle>
                </DialogHeader>
                <form onSubmit={createChannel} className="space-y-4">
                  <div>
                    <Input
                      placeholder="Channel Name"
                      name="name"
                      required
                    />
                  </div>
                  <div>
                    <Textarea
                      placeholder="Channel Description"
                      name="description"
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={isCreating}>
                    {isCreating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      'Create Channel'
                    )}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>

        <div className="grid md:grid-cols-[300px,1fr] gap-6">
          <div className="space-y-4">
            {isChannelsLoading ? (
              <div className="flex items-center justify-center p-4">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : channels?.length ? (
              channels.map((channel) => (
                <Card
                  key={channel.id}
                  className={`p-4 cursor-pointer transition-colors ${
                    selectedChannel === channel.id ? 'bg-accent' : ''
                  }`}
                  onClick={() => setSelectedChannel(channel.id)}
                >
                  <h3 className="font-semibold">{channel.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {channel.description}
                  </p>
                </Card>
              ))
            ) : (
              <p className="text-center text-muted-foreground p-4">
                No channels available
              </p>
            )}
          </div>

          <div className="space-y-4">
            {selectedChannel ? (
              isPostsLoading ? (
                <div className="flex items-center justify-center p-4">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : postsError ? (
                <div className="text-center text-destructive">
                  Error loading posts: {postsError.message}
                </div>
              ) : channelPosts?.length ? (
                channelPosts.map((post) => (
                  <Card key={post.id} className="p-4">
                    <VoicePost post={post} />
                  </Card>
                ))
              ) : (
                <p className="text-center text-muted-foreground">
                  No posts in this channel yet
                </p>
              )
            ) : (
              <p className="text-center text-muted-foreground">
                Select a channel to view posts
              </p>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}