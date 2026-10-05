import { Link } from "react-router";

import { AuthPage } from "~/components/auth";
import { Button } from "~/components/ui/button";
import { CONTACT_EMAIL } from "~/lib/site";

// The 403 page (app/lib/auth/admin.server.ts). Rendered by the root error
// boundary when the admin guard stops a request before any loader ran, and by
// the admin layout's boundary otherwise.
export function Forbidden() {
  return (
    <AuthPage title="Ehhez nincs jogod" intro="Ezt az oldalt csak a szervezők és a főadmin látják.">
      <p className="text-muted-foreground">
        Ha szerinted tévedés, írj a{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
          {CONTACT_EMAIL}
        </a>{" "}
        címre.
      </p>
      <div>
        <Button asChild variant="outline" className="h-11 px-5">
          <Link to="/account">Vissza a fiókodhoz</Link>
        </Button>
      </div>
    </AuthPage>
  );
}
