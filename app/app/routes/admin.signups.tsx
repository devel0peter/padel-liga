import { redirect } from "react-router";

// Jelentkezők went with the interest list (#333, D128): its old address,
// with or without filters, leads to the admin home.
export function loader() {
  throw redirect("/admin");
}
