import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { QueryProvider } from "./query-client.js";
import { TooltipProvider } from "./components/ui/tooltip";

export const links: Route.LinksFunction = () => [
  { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
  { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
  { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
  { rel: "manifest", href: "/site.webmanifest" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <TooltipProvider>{children}</TooltipProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <QueryProvider>
      <Outlet />
    </QueryProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let detail = "The application could not complete this request.";

  if (isRouteErrorResponse(error)) {
    title = error.status === 404 ? "Page not found" : `Request failed (${error.status})`;
    detail = error.statusText || detail;
  } else if (error instanceof Error) {
    detail = error.message;
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-3xl place-content-center px-6">
      <p className="text-primary text-sm font-semibold uppercase tracking-[0.2em]">Squee Online</p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight">{title}</h1>
      <p className="text-muted-foreground mt-4">{detail}</p>
    </main>
  );
}
