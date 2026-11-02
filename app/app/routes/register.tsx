import type { Route } from "./+types/register";
import { AuthForm } from "./login";
import { SITE_NAME } from "~/lib/site";

// Registration (2026-10-31): the login flow with its own words; the first
// login of a new address creates the account (#113).
export { action, loader } from "./login";

export function meta({}: Route.MetaArgs) {
  return [{ title: `Regisztráció – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export default function Register(props: Route.ComponentProps) {
  return <AuthForm {...props} mode="register" />;
}
