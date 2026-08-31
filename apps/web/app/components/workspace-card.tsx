import { ArrowRight, FolderKanban } from "lucide-react";
import { Link } from "react-router";

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "~/components/ui/card";

export interface WorkspaceCardItem {
  createdAt: string;
  description: string | null;
  id: string;
  name: string;
}

export function WorkspaceCard({ workspace }: { workspace: WorkspaceCardItem }) {
  return (
    <Link
      to={`/workspaces/${workspace.id}`}
      className="group rounded-xl focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Card className="h-full transition-colors group-hover:bg-muted/40">
        <CardHeader>
          <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FolderKanban className="size-4" aria-hidden="true" />
          </div>
          <CardTitle className="line-clamp-1">{workspace.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex-1">
          <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">
            {workspace.description || "No description yet."}
          </p>
        </CardContent>
        <CardFooter className="justify-between text-xs text-muted-foreground">
          <time dateTime={workspace.createdAt}>
            Created{" "}
            {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
              new Date(workspace.createdAt),
            )}
          </time>
          <ArrowRight
            className="size-4 transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </CardFooter>
      </Card>
    </Link>
  );
}
