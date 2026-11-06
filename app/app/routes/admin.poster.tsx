import { redirect } from "react-router";

// The poster page went with the interest list (#333, D128): its old address
// (and a club's `?ref=`) leads to the admin home.
export function loader() {
  throw redirect("/admin");
}
