import { Layout } from '@/components/Layout';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { useUser } from '../hooks/use-user';
import { VoicePost } from '@/components/VoicePost';
import { PointsStats } from '@/components/PointsStats';
import useSWR from 'swr';
import type { Post } from 'db/schema';
import { Star } from 'lucide-react';

export function Profile() {
  const { user } = useUser();
  const { data: userPosts } = useSWR<Post[]>(
    user ? `/api/posts/user/${user.id}` : null
  );

  if (!user) return <div>Please log in</div>;
  if (!userPosts) return <div>Loading...</div>;

  return (
    <Layout>
      <div className="max-w-4xl mx-auto p-4 space-y-8">
        <Card className="p-6">
          <div className="flex items-center space-x-4">
            <Avatar className="w-20 h-20">
              <AvatarImage src={`https://avatar.vercel.sh/${user.username}`} />
              <AvatarFallback>{user.username[0].toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold">{user.username}</h2>
              <div className="flex items-center space-x-4">
                <p className="text-muted-foreground">
                  {userPosts.length} voice posts
                </p>
                <div className="flex items-center text-yellow-500">
                  <Star className="h-4 w-4 mr-1 fill-current" />
                  <span>{user.points} Sukuma Points</span>
                </div>
              </div>
            </div>
          </div>
        </Card>

        <PointsStats points={user.points} postCount={userPosts.length} />

        <div className="space-y-4">
          <h3 className="text-xl font-semibold">Voice Posts</h3>
          {userPosts.map((post) => (
            <Card key={post.id} className="p-4">
              <VoicePost post={post} />
            </Card>
          ))}
          {userPosts.length === 0 && (
            <Card className="p-8 text-center">
              <p className="text-muted-foreground">No voice posts yet</p>
            </Card>
          )}
        </div>
      </div>
    </Layout>
  );
}
