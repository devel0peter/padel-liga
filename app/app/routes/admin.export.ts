import { redirect } from "react-router";

// The CSV of the interest list went with Jelentkezők (#333, D128): its old
// address leads to the admin home.
export function loader() {
  throw redirect("/admin");
}
