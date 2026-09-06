import { MessageSquare, Plus } from "lucide-react";
import { Button } from "~/components/ui/button";
export function WorkspaceChats() {
  return (
    <section>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">Chats</h2>
        <Button disabled aria-describedby="chats-coming-soon">
          <Plus aria-hidden="true" /> New chat
        </Button>
      </div>
      <div className="mt-5 rounded-xl border border-dashed px-6 py-16 text-center">
        <MessageSquare
          className="mx-auto mb-4 size-10 text-muted-foreground/60"
          aria-hidden="true"
        />
        <h3 id="chats-coming-soon" className="font-semibold">
          Coming soon
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          Chats will let you ask questions using selected documents from this workspace. For now,
          add and organize your documents here.
        </p>
      </div>
    </section>
  );
}
