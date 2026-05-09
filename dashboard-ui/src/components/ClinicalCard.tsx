import { AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

interface Props<T> {
  /** DOM id used by the copilot SourceDrawer's "View in chart" scroll target. */
  id?: string;
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
  id,
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
    <Card id={id}>
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
      <CardContent className="p-0">
        {isLoading && (
          <div className="px-4 py-3 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
        {isError && (
          <div className="px-4 py-3 flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error instanceof Error ? error.message : 'Failed to load.'}</span>
          </div>
        )}
        {!isLoading && !isError && items.length === 0 && (
          <p className="px-4 py-3 text-sm text-muted-foreground">{emptyMessage}</p>
        )}
        {!isLoading && !isError && items.length > 0 && (
          <div className="text-sm">
            {items.map((item, i) => (
              <div
                key={i}
                className={`px-4 py-1.5 ${i % 2 === 1 ? 'bg-slate-50' : 'bg-white'}`}
              >
                {renderItem(item, i)}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
