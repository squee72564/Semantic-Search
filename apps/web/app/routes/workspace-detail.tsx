import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileText, MessageSquare } from "lucide-react";
import { useCallback } from "react";
import { data, isRouteErrorResponse, Link, useSearchParams } from "react-router";
import type { Route } from "./+types/workspace-detail";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "~/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { WorkspaceHeader } from "~/components/workspaces/workspace-header";
import { WorkspaceDocuments } from "~/components/workspaces/workspace-documents";
import { WorkspaceChats } from "~/components/workspaces/workspace-chats";
import { browserApiClient } from "~/lib/api.client";
import { createServerApiClient } from "~/lib/api.server";
import { createQueryClient } from "~/query-client";
import { WorkspaceApiError, workspaceQuery } from "~/queries/workspaces";

export function meta() {
  return [{ title: "Workspace | Squee Online" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  try {
    return await createQueryClient().fetchQuery(
      workspaceQuery(createServerApiClient(request), params.workspaceId),
    );
  } catch (error) {
    if (error instanceof WorkspaceApiError && error.status === 404) {
      throw data(null, { status: 404, statusText: "Not Found" });
    }
    throw error;
  }
}

export default function WorkspaceDetail({
  loaderData,
  params,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>;
  params: { workspaceId: string };
}) {
  const detail = useQuery({
    ...workspaceQuery(browserApiClient, params.workspaceId),
    initialData: loaderData,
  });
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "chats" ? "chats" : "documents";
  const changeTab = useCallback(
    (value: string) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (value === "chats") next.set("tab", "chats");
          else next.delete("tab");
          return next;
        },
        { preventScrollReset: true },
      );
    },
    [setSearchParams],
  );
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <WorkspaceHeader key={params.workspaceId} workspace={detail.data.item} />
      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList aria-label="Workspace sections">
          <TabsTrigger value="documents">
            <FileText className="size-4" aria-hidden="true" /> Documents
          </TabsTrigger>
          <TabsTrigger value="chats">
            <MessageSquare className="size-4" aria-hidden="true" /> Chats
          </TabsTrigger>
        </TabsList>
        <TabsContent value="documents" forceMount>
          <WorkspaceDocuments
            key={params.workspaceId}
            workspaceId={params.workspaceId}
            active={tab === "documents"}
          />
        </TabsContent>
        <TabsContent value="chats">
          <WorkspaceChats />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const notFound =
    (error instanceof WorkspaceApiError && error.status === 404) ||
    (isRouteErrorResponse(error) && error.status === 404);
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
      <Card className={notFound ? "border-dashed" : "border-destructive/30"}>
        <CardHeader>
          <h1 className="text-lg font-semibold">
            {notFound ? "Workspace not found" : "Unable to load workspace"}
          </h1>
          <CardDescription>
            {notFound
              ? "This workspace does not exist or you do not have access to it."
              : "The workspace service could not be reached. Please try again later."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link to="/workspaces">
              <ArrowLeft aria-hidden="true" /> Back to Workspaces
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
