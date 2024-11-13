import { Card } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Star } from 'lucide-react';

interface PointsStatsProps {
  points: number;
  postCount: number;
}

export function PointsStats({ points, postCount }: PointsStatsProps) {
  const data = [
    { name: 'Posts', value: postCount * 10 },
    { name: 'Likes', value: points - (postCount * 10) },
  ];

  return (
    <Card className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold mb-2">Sukuma Points Breakdown</h3>
        <div className="flex items-center text-yellow-500 mb-4">
          <Star className="h-6 w-6 mr-2 fill-current" />
          <span className="text-2xl font-bold">{points} Total Points</span>
        </div>
      </div>
      
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="name" className="text-muted-foreground" />
            <YAxis className="text-muted-foreground" />
            <Tooltip 
              contentStyle={{ 
                background: 'hsl(var(--background))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '0.5rem',
              }}
              labelStyle={{ color: 'hsl(var(--foreground))' }}
            />
            <Bar dataKey="value" fill="hsl(var(--primary))" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
