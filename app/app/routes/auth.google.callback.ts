import type { Route } from "./+types/auth.google.callback";
import { finishGoogleLogin } from "~/lib/auth/google.server";

export function loader({ request }: Route.LoaderArgs) {
  return finishGoogleLogin(request);
}
