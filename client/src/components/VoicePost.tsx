import { forwardRef, useState, useEffect } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Heart, MessageCircle, Pause, Play } from 'lucide-react';
import type { Post } from 'db/schema';
import { useUser } from '../hooks/use-user';
import { mutate } from 'swr';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { VoiceRecorder } from './VoiceRecorder';
import useSWR from 'swr';

interface VoicePostProps {
  post: Post;
  isPlaying?: boolean;
  onPlay?: () => void;
  onPause?: () => void;
}

export const VoicePost = forwardRef<HTMLAudioElement, VoicePostProps>(
  ({ post, isPlaying, onPlay, onPause }, ref) => {
    const { user } = useUser();
    const [isLiked, setIsLiked] = useState(post.likes?.includes(user?.id ?? -1));
    const [isReplying, setIsReplying] = useState(false);
    const { data: replies } = useSWR<Post[]>(`/api/posts/${post.id}/replies`);
    const [replyCount, setReplyCount] = useState(post.replies?.length ?? 0);

    useEffect(() => {
      if (replies) {
        setReplyCount(replies.length);
      }
    }, [replies]);

    const handleLike = async () => {
      if (!user) return;
      
      try {
        const response = await fetch(`/api/posts/${post.id}/like`, {
          method: 'POST',
          credentials: 'include',
        });
        
        if (response.ok) {
          setIsLiked(!isLiked);
          mutate('/api/posts');
          if (post.channel_id) {
            mutate(`/api/channels/${post.channel_id}/posts`);
          }
        }
      } catch (error) {
        console.error('Error liking post:', error);
      }
    };

    const handleReplySuccess = () => {
      setIsReplying(false);
      mutate(`/api/posts/${post.id}/replies`);
    };

    return (
      <div className="space-y-4">
        <div className="flex items-center space-x-4">
          <Avatar>
            <AvatarImage src={`https://avatar.vercel.sh/${post.username}`} />
            <AvatarFallback>{post.username[0].toUpperCase()}</AvatarFallback>
          </Avatar>
          <div>
            <h3 className="font-semibold">{post.username}</h3>
            <p className="text-sm text-muted-foreground">
              {new Date(post.created_at).toLocaleDateString()}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <Button
            variant="outline"
            size="icon"
            onClick={isPlaying ? onPause : onPlay}
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <audio ref={ref} src={post.audio_url} />
          
          <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{
                width: `${isPlaying ? '100%' : '0'}%`,
                transition: isPlaying ? 'width linear' : 'none',
                transitionDuration: isPlaying ? `${post.duration}s` : '0s',
              }}
            />
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <Button
            variant="ghost"
            size="sm"
            className={isLiked ? 'text-red-500' : ''}
            onClick={handleLike}
            disabled={!user}
            aria-label={`Like post (${post.likes?.length ?? 0} likes)`}
          >
            <Heart className={`h-4 w-4 mr-2 ${isLiked ? 'fill-current' : ''}`} />
            {post.likes?.length ?? 0}
          </Button>
          <Dialog open={isReplying} onOpenChange={setIsReplying}>
            <DialogTrigger asChild>
              <Button 
                variant="ghost" 
                size="sm"
                disabled={!user}
                aria-label={`Reply to post (${replyCount} replies)`}
              >
                <MessageCircle className="h-4 w-4 mr-2" />
                {replyCount}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <VoiceRecorder 
                replyingTo={post} 
                onSuccess={handleReplySuccess}
              />
            </DialogContent>
          </Dialog>
        </div>

        {post.transcript && (
          <p className="text-sm text-muted-foreground">{post.transcript}</p>
        )}

        {replies && replies.length > 0 && (
          <div className="space-y-4 pl-8 border-l-2 border-muted">
            {replies.map((reply) => (
              <VoicePost
                key={reply.id}
                post={reply}
              />
            ))}
          </div>
        )}
      </div>
    );
  }
);

VoicePost.displayName = 'VoicePost';
