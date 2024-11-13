import { Layout } from '@/components/Layout';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { useUser } from '../hooks/use-user';
import { VoicePost } from '@/components/VoicePost';
import useSWR from 'swr';
import type { Post } from 'db/schema';

export function Profile() {
  const { user } = useUser();
  const { data: userPosts } = useSWR<Post[]>(`/api/posts/user/${user?.id}`);

  if (!user) return <div>Please log in</div>;
  if (!userPosts) return <div>Loading...</div>;

  return (
    <Layout>
      <div className="max-w-2xl mx-auto p-4 space-y-8">
        <Card className="p-6">
          <div className="flex items-center space-x-4">
            <Avatar className="w-20 h-20">
              <AvatarImage src={`https://avatar.vercel.sh/${user.username}`} />
              <AvatarFallback>{user.username[0].toUpperCase()}</AvatarFallback>
            </Avatar>
            <div>
              <h2 className="text-2xl font-bold">{user.username}</h2>
              <p className="text-muted-foreground">
                {userPosts.length} voice posts
              </p>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          {userPosts.map((post) => (
            <Card key={post.id} className="p-4">
              <VoicePost post={post} />
            </Card>
          ))}
        </div>
      </div>
    </Layout>
  );
}
