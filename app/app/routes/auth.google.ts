import type { Route } from "./+types/auth.google";
import { startGoogleLogin } from "~/lib/auth/google.server";

export function loader({ request }: Route.LoaderArgs) {
  return startGoogleLogin(request);
}
