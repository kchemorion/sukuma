import { forwardRef, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Heart, MessageCircle, Pause, Play } from 'lucide-react';
import type { Post } from 'db/schema';
import { useUser } from '../hooks/use-user';
import { mutate } from 'swr';

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

    const handleLike = async () => {
      if (!user) return;
      
      const response = await fetch(`/api/posts/${post.id}/like`, {
        method: 'POST',
      });
      
      if (response.ok) {
        setIsLiked(!isLiked);
        mutate('/api/posts');
      }
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
              {new Date(post.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <Button
            variant="outline"
            size="icon"
            onClick={isPlaying ? onPause : onPlay}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <audio ref={ref} src={post.audioUrl} />
          
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
          >
            <Heart className="h-4 w-4 mr-2" />
            {post.likes?.length ?? 0}
          </Button>
          <Button variant="ghost" size="sm">
            <MessageCircle className="h-4 w-4 mr-2" />
            {post.replies?.length ?? 0}
          </Button>
        </div>

        {post.transcript && (
          <p className="text-sm text-muted-foreground">{post.transcript}</p>
        )}
      </div>
    );
  }
);

VoicePost.displayName = 'VoicePost';
