import type { Session, User } from "better-auth";

export const REQUEST_ID_CONTEXT_KEY = "requestId";
export const CURRENT_USER_CONTEXT_KEY = "currentUser";
export const SESSION_CONTEXT_KEY = "session";

export type AppVariables = {
  requestId: string;
  session: Session | null;
  currentUser: User | null;
};
