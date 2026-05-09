import { AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

interface Props<T> {
  title: string;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  items: T[];
  emptyMessage?: string;
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Header right-side action (e.g. filter chip, link to full list). */
  action?: React.ReactNode;
}

export function ClinicalCard<T>({
  title,
  isLoading,
  isError,
  error,
  items,
  emptyMessage = 'None recorded.',
  renderItem,
  action,
}: Props<T>) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <CardTitle>{title}</CardTitle>
          {!isLoading && !isError && (
            <Badge variant="secondary" className="text-[11px] px-1.5">
              {items.length}
            </Badge>
          )}
        </div>
        {action}
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
        {isError && (
          <div className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error instanceof Error ? error.message : 'Failed to load.'}</span>
          </div>
        )}
        {!isLoading && !isError && items.length === 0 && (
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        )}
        {!isLoading && !isError && items.length > 0 && (
          <ul className="divide-y -mx-1">
            {items.map((item, i) => (
              <li key={i} className="py-2 px-1 text-sm first:pt-0 last:pb-0">
                {renderItem(item, i)}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
