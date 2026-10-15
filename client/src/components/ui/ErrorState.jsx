import { Icon } from "./Icon";
import { Button } from "./Button";

export function ErrorState({ title = "Unable to load this view", message, onRetry }) {
  return (
    <div role="alert" className="bg-error-container/60 border border-red-200 rounded-xl p-space-lg flex flex-col sm:flex-row sm:items-center gap-space-md">
      <div className="w-10 h-10 rounded-lg bg-error-container flex items-center justify-center text-error shrink-0">
        <Icon name="error" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-headline-sm text-headline-sm text-on-error-container">{title}</h3>
        <p className="font-body-sm text-body-sm text-on-error-container/80">{message}</p>
      </div>
      {onRetry ? (
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
