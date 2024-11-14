import { Card } from './ui/card';
import { Mic } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description: string;
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <Card className="p-8 text-center">
      <div className="flex flex-col items-center space-y-3">
        <div className="rounded-full bg-muted p-3">
          <Mic className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="font-semibold text-lg">{title}</h3>
        <p className="text-muted-foreground">{description}</p>
      </div>
    </Card>
  );
}
