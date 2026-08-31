import { index, layout, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  layout("routes/authenticated.tsx", [
    route("dashboard", "routes/dashboard.tsx"),
    route("workspaces", "routes/workspaces.tsx"),
    route("workspaces/:workspaceId", "routes/workspace-detail.tsx"),
  ]),
] satisfies RouteConfig;
